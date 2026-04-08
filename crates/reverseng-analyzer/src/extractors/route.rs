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

    // Remix loader/action 패턴
    let remix_routes = extract_remix_exports(tree, source, file_path);
    for route in remix_routes {
        if !routes.iter().any(|r| r.path == route.path) {
            routes.push(route);
        }
    }

    Ok(routes)
}

/// Next.js/Nuxt 파일 기반 라우팅에서 경로 추론
/// pages/ 디렉토리 (Pages Router) + app/ 디렉토리 (App Router) 지원
fn infer_nextjs_route(file_path: &str) -> Option<RouteInfo> {
    let path = file_path.replace('\\', "/");

    let (route_part, is_app_router) = if let Some(idx) = path.find("app/") {
        (&path[idx + 4..], true)
    } else if let Some(idx) = path.find("pages/") {
        (&path[idx + 6..], false)
    } else {
        return None;
    };

    if is_app_router {
        infer_app_router_route(route_part, file_path)
    } else {
        infer_pages_router_route(route_part, file_path)
    }
}

/// Next.js App Router: app/dashboard/page.tsx → /dashboard
fn infer_app_router_route(route_part: &str, file_path: &str) -> Option<RouteInfo> {
    let file_name = route_part.rsplit('/').next()?;

    // App Router 특수 파일만 라우트로 인정
    let stripped = file_name
        .trim_end_matches(".tsx")
        .trim_end_matches(".ts")
        .trim_end_matches(".jsx")
        .trim_end_matches(".js");

    let route_type = match stripped {
        "page" => "page",
        "layout" => "layout",
        "loading" => "loading",
        "error" => "error",
        "not-found" => "not-found",
        _ => return None, // 특수 파일이 아니면 라우트 아님
    };

    // 디렉토리 경로에서 라우트 경로 추론
    let dir_path = route_part.rsplit_once('/').map(|(d, _)| d).unwrap_or("");

    let route_path = dir_path
        // 라우트 그룹 제거: (marketing)/about → about
        .split('/')
        .filter(|seg| !seg.starts_with('(') || !seg.ends_with(')'))
        // 동적 세그먼트: [id] → :id, [...slug] → :slug*, [[...slug]] → :slug*?
        .map(|seg| {
            if seg.starts_with("[[...") && seg.ends_with("]]") {
                // Optional catch-all: [[...slug]] → :slug
                let name = &seg[5..seg.len()-2];
                format!(":{}", name)
            } else if seg.starts_with("[...") && seg.ends_with(']') {
                // Catch-all: [...slug] → :slug*
                let name = &seg[4..seg.len()-1];
                format!(":{}*", name)
            } else if seg.starts_with('[') && seg.ends_with(']') {
                format!(":{}", &seg[1..seg.len()-1])
            } else if seg.starts_with('@') {
                // 패러렐 라우트: @modal 등 → 스킵
                return String::new();
            } else {
                seg.to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/");

    let route_path = if route_path.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", route_path)
    };

    Some(RouteInfo {
        path: route_path,
        component: format!("{}:{}", stripped, file_path.rsplit('/').nth(1).unwrap_or("root")),
        file_path: file_path.to_string(),
        guards: vec![],
        children: vec![],
        meta: Some(serde_json::json!({ "routeType": route_type })),
    })
}

/// Next.js Pages Router: pages/about.tsx → /about
fn infer_pages_router_route(route_part: &str, file_path: &str) -> Option<RouteInfo> {
    let route_path = route_part
        .trim_end_matches(".tsx")
        .trim_end_matches(".ts")
        .trim_end_matches(".jsx")
        .trim_end_matches(".js")
        .trim_end_matches(".vue")
        .replace("[", ":")
        .replace("]", "");

    // index 파일 처리: /index → /, dashboard/index → /dashboard
    let route_path = if route_path == "index" {
        "/".to_string()
    } else {
        let cleaned = route_path
            .replace("/index", "")
            .trim_end_matches("/index")
            .to_string();
        if cleaned.is_empty() {
            "/".to_string()
        } else if !cleaned.starts_with('/') {
            format!("/{}", cleaned)
        } else {
            cleaned
        }
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

/// Remix loader/action 패턴 추출
pub fn extract_remix_exports(tree: &Tree, source: &str, file_path: &str) -> Vec<RouteInfo> {
    let mut routes = Vec::new();

    // export function loader / export async function loader
    // export function action / export async function action
    let export_nodes = collect_nodes_by_kind(tree, &["export_statement"]);

    let mut has_loader = false;
    let mut has_action = false;

    for export in &export_nodes {
        let text = node_text(export, source);
        if text.contains("function loader") || text.contains("const loader") {
            has_loader = true;
        }
        if text.contains("function action") || text.contains("const action") {
            has_action = true;
        }
    }

    // Remix 파일 기반 라우팅: app/routes/dashboard.tsx → /dashboard
    if (has_loader || has_action) && file_path.contains("routes/") {
        let path = file_path.replace('\\', "/");
        if let Some(idx) = path.find("routes/") {
            let route_part = &path[idx + 7..];
            let route_path = route_part
                .trim_end_matches(".tsx")
                .trim_end_matches(".ts")
                .trim_end_matches(".jsx")
                .trim_end_matches(".js");

            // Remix naming: _index → root, _ → pathless layout, $ → dynamic, . → nested
            let route_path = route_path
                .replace("._index", "")  // users._index → users
                .replace("_index", "")   // _index → root
                .replace("$", ":")
                .replace('.', "/")
                .replace('_', "/");

            // 이중 슬래시 정리
            let route_path = route_path
                .split('/')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("/");

            let route_path = if route_path.is_empty() {
                "/".to_string()
            } else {
                format!("/{}", route_path)
            };

            let mut guards = Vec::new();
            if has_loader { guards.push("loader".to_string()); }
            if has_action { guards.push("action".to_string()); }

            routes.push(RouteInfo {
                path: route_path,
                component: file_path.rsplit('/').next().unwrap_or("").to_string(),
                file_path: file_path.to_string(),
                guards,
                children: vec![],
                meta: Some(serde_json::json!({ "framework": "remix" })),
            });
        }
    }

    routes
}
