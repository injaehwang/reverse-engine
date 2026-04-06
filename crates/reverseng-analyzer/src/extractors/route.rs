use anyhow::Result;
use reverseng_core::types::analyzer::RouteInfo;
use tree_sitter::Tree;

use super::{collect_nodes_by_kind, find_child_by_field, node_text};

/// AST에서 라우트 정의 추출
/// React Router, Vue Router, Next.js 파일 기반 라우팅 등 지원
pub fn extract(tree: &Tree, source: &str, file_path: &str) -> Result<Vec<RouteInfo>> {
    let mut routes = Vec::new();

    // React Router 패턴: <Route path="..." component={...} />
    let jsx_nodes = collect_nodes_by_kind(tree, &["jsx_self_closing_element", "jsx_opening_element"]);

    for node in &jsx_nodes {
        let tag_name = node
            .children(&mut node.walk())
            .find(|c| c.kind() == "identifier" || c.kind() == "member_expression")
            .map(|n| node_text(&n, source));

        if tag_name.as_deref() != Some("Route") {
            continue;
        }

        let mut path = String::new();
        let mut component = String::new();

        // JSX 속성에서 path와 component/element 추출
        let attr_nodes = collect_nodes_by_kind(tree, &["jsx_attribute"]);
        // 이 Route 태그에 속한 속성만 필터링
        for attr in &attr_nodes {
            if attr.start_byte() < node.start_byte() || attr.end_byte() > node.end_byte() {
                continue;
            }

            let attr_name = find_child_by_field(attr, "name")
                .or_else(|| attr.children(&mut attr.walk()).next())
                .map(|n| node_text(&n, source).to_string())
                .unwrap_or_default();

            let attr_value = attr
                .children(&mut attr.walk())
                .nth(2)  // name = value
                .map(|n| node_text(&n, source).trim_matches(&['"', '\'', '{', '}'] as &[char]).to_string())
                .unwrap_or_default();

            match attr_name.as_str() {
                "path" => path = attr_value,
                "component" | "element" => component = attr_value,
                _ => {}
            }
        }

        if !path.is_empty() {
            routes.push(RouteInfo {
                path,
                component,
                file_path: file_path.to_string(),
                guards: vec![],
                children: vec![],
                meta: None,
            });
        }
    }

    // Vue Router 패턴: { path: '...', component: ... }
    // 객체 리터럴에서 path와 component 키를 가진 것 탐지
    let object_nodes = collect_nodes_by_kind(tree, &["object"]);
    for obj in &object_nodes {
        let mut path = None;
        let mut component = None;

        let mut cursor = obj.walk();
        for child in obj.children(&mut cursor) {
            if child.kind() == "pair" {
                let key = find_child_by_field(&child, "key")
                    .map(|n| node_text(&n, source).trim_matches(&['"', '\''] as &[char]).to_string());
                let value = find_child_by_field(&child, "value")
                    .map(|n| node_text(&n, source).trim_matches(&['"', '\''] as &[char]).to_string());

                match key.as_deref() {
                    Some("path") => path = value,
                    Some("component") => component = value,
                    _ => {}
                }
            }
        }

        if let (Some(p), Some(c)) = (path, component) {
            if p.starts_with('/') {
                routes.push(RouteInfo {
                    path: p,
                    component: c,
                    file_path: file_path.to_string(),
                    guards: vec![],
                    children: vec![],
                    meta: None,
                });
            }
        }
    }

    // Next.js 파일 기반 라우팅: 파일 경로에서 추론
    if file_path.contains("pages/") || file_path.contains("app/") {
        if let Some(route) = infer_nextjs_route(file_path) {
            // 이미 추출된 라우트와 중복이 아니면 추가
            if !routes.iter().any(|r| r.path == route.path) {
                routes.push(route);
            }
        }
    }

    Ok(routes)
}

/// Next.js/Nuxt 파일 기반 라우팅에서 경로 추론
fn infer_nextjs_route(file_path: &str) -> Option<RouteInfo> {
    let path = file_path.replace('\\', "/");

    // pages/ 이후 경로 추출
    let route_part = if let Some(idx) = path.find("pages/") {
        &path[idx + 6..]
    } else if let Some(idx) = path.find("app/") {
        &path[idx + 4..]
    } else {
        return None;
    };

    // index.tsx → /, about.tsx → /about, [id].tsx → /:id
    let route_path = route_part
        .trim_end_matches(".tsx")
        .trim_end_matches(".ts")
        .trim_end_matches(".jsx")
        .trim_end_matches(".js")
        .trim_end_matches(".vue")
        .replace("/index", "")
        .replace("/page", "")
        .replace('[', ":")
        .replace(']', "");

    let route_path = if route_path.is_empty() {
        "/".to_string()
    } else if !route_path.starts_with('/') {
        format!("/{}", route_path)
    } else {
        route_path
    };

    let component_name = file_path
        .rsplit('/')
        .next()?
        .split('.')
        .next()?
        .to_string();

    Some(RouteInfo {
        path: route_path,
        component: component_name,
        file_path: file_path.to_string(),
        guards: vec![],
        children: vec![],
        meta: None,
    })
}
