use anyhow::Result;
use reverseng_core::types::analyzer::{ComponentInfo, ComponentType, PropInfo};
use tree_sitter::Tree;

use super::{collect_nodes_by_kind, find_child_by_field, find_child_by_kind, node_text};

/// AST에서 컴포넌트 정의 추출 (React/Vue)
pub fn extract(
    tree: &Tree,
    source: &str,
    file_path: &str,
    ext: &str,
) -> Result<Vec<ComponentInfo>> {
    let mut components = Vec::new();

    match ext {
        "tsx" | "jsx" => extract_react_components(tree, source, file_path, &mut components)?,
        "vue" => extract_vue_component(tree, source, file_path, &mut components)?,
        _ => extract_react_components(tree, source, file_path, &mut components)?,
    }

    Ok(components)
}

fn extract_react_components(
    tree: &Tree,
    source: &str,
    file_path: &str,
    components: &mut Vec<ComponentInfo>,
) -> Result<()> {
    // 1. function 컴포넌트 (대문자로 시작하는 함수/화살표)
    let func_kinds = [
        "function_declaration",
        "arrow_function",
        "function",
    ];
    let func_nodes = collect_nodes_by_kind(tree, &func_kinds);

    for node in &func_nodes {
        let name = get_component_name(node, source);
        if name.is_empty() || !name.chars().next().unwrap_or('a').is_uppercase() {
            continue; // React 컴포넌트는 대문자로 시작
        }

        // JSX 반환 여부 확인
        let body_text = node_text(node, source);
        if !body_text.contains('<') {
            continue; // JSX를 반환하지 않으면 컴포넌트가 아님
        }

        let props = extract_react_props(node, source);
        let children = extract_jsx_children(node, source);
        let hooks = extract_hooks(node, source);
        let api_calls = extract_api_calls_in_component(node, source);

        let component_type = infer_component_type(file_path, &name);

        components.push(ComponentInfo {
            name,
            file_path: file_path.to_string(),
            line_start: node.start_position().row + 1,
            line_end: node.end_position().row + 1,
            component_type,
            props,
            children,
            used_by: vec![],
            hooks,
            api_calls,
        });
    }

    Ok(())
}

fn extract_vue_component(
    tree: &Tree,
    source: &str,
    file_path: &str,
    components: &mut Vec<ComponentInfo>,
) -> Result<()> {
    // Vue SFC는 파일 자체가 하나의 컴포넌트
    let name = file_path
        .rsplit('/')
        .next()
        .unwrap_or(file_path)
        .trim_end_matches(".vue")
        .to_string();

    let hooks = extract_hooks(&tree.root_node(), source);
    let api_calls = extract_api_calls_in_component(&tree.root_node(), source);

    components.push(ComponentInfo {
        name,
        file_path: file_path.to_string(),
        line_start: 1,
        line_end: tree.root_node().end_position().row + 1,
        component_type: infer_component_type(file_path, ""),
        props: vec![], // TODO: defineProps 추출
        children: vec![],
        used_by: vec![],
        hooks,
        api_calls,
    });

    Ok(())
}

fn get_component_name(node: &tree_sitter::Node, source: &str) -> String {
    if let Some(name_node) = find_child_by_field(node, "name") {
        return node_text(&name_node, source).to_string();
    }

    // arrow function → variable_declarator → name
    if node.kind() == "arrow_function" {
        if let Some(parent) = node.parent() {
            if parent.kind() == "variable_declarator" {
                if let Some(name_node) = find_child_by_field(&parent, "name") {
                    return node_text(&name_node, source).to_string();
                }
            }
        }
    }

    String::new()
}

fn extract_react_props(node: &tree_sitter::Node, source: &str) -> Vec<PropInfo> {
    let mut props = Vec::new();

    // 첫 번째 매개변수가 destructuring이면 props 추출
    let params = find_child_by_field(node, "parameters")
        .or_else(|| find_child_by_kind(node, "formal_parameters"));

    if let Some(params) = params {
        let mut cursor = params.walk();
        for child in params.children(&mut cursor) {
            if child.kind() == "object_pattern" {
                // { name, age, ...rest }
                let mut inner_cursor = child.walk();
                for prop in child.children(&mut inner_cursor) {
                    if prop.kind() == "shorthand_property_identifier_pattern"
                        || prop.kind() == "pair_pattern"
                    {
                        let name = node_text(&prop, source)
                            .split(':')
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if !name.is_empty() && name != "{" && name != "}" && name != "," {
                            props.push(PropInfo {
                                name,
                                prop_type: "unknown".into(),
                                required: true,
                                default_value: None,
                            });
                        }
                    }
                }
            }
        }
    }

    props
}

/// JSX에서 사용된 자식 컴포넌트 추출 (대문자로 시작하는 태그)
fn extract_jsx_children(node: &tree_sitter::Node, source: &str) -> Vec<String> {
    let mut children = Vec::new();
    collect_jsx_elements(*node, source, &mut children);
    children.sort();
    children.dedup();
    children
}

fn collect_jsx_elements(node: tree_sitter::Node, source: &str, children: &mut Vec<String>) {
    if node.kind() == "jsx_opening_element" || node.kind() == "jsx_self_closing_element" {
        if let Some(name_node) = find_child_by_kind(&node, "identifier")
            .or_else(|| find_child_by_kind(&node, "member_expression"))
        {
            let name = node_text(&name_node, source).to_string();
            // 대문자로 시작하는 것만 (HTML 태그 제외)
            if name.chars().next().unwrap_or('a').is_uppercase() {
                children.push(name);
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_jsx_elements(child, source, children);
    }
}

/// React Hooks 사용 추출
fn extract_hooks(node: &tree_sitter::Node, source: &str) -> Vec<String> {
    let mut hooks = Vec::new();
    collect_hook_calls(*node, source, &mut hooks);
    hooks.sort();
    hooks.dedup();
    hooks
}

fn collect_hook_calls(node: tree_sitter::Node, source: &str, hooks: &mut Vec<String>) {
    if node.kind() == "call_expression" {
        if let Some(func) = find_child_by_field(&node, "function") {
            let name = node_text(&func, source);
            // use로 시작하는 함수 호출 = React Hook
            if name.starts_with("use") {
                hooks.push(name.to_string());
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_hook_calls(child, source, hooks);
    }
}

/// 컴포넌트 내 API 호출 추출
fn extract_api_calls_in_component(node: &tree_sitter::Node, source: &str) -> Vec<String> {
    let mut apis = Vec::new();
    collect_api_patterns(*node, source, &mut apis);
    apis.sort();
    apis.dedup();
    apis
}

fn collect_api_patterns(node: tree_sitter::Node, source: &str, apis: &mut Vec<String>) {
    if node.kind() == "call_expression" {
        if let Some(func) = find_child_by_field(&node, "function") {
            let func_text = node_text(&func, source);
            // fetch, axios.get/post, api.get 등의 패턴
            if func_text.contains("fetch")
                || func_text.contains("axios")
                || func_text.contains("api.")
                || func_text.contains("$http")
            {
                // 첫 번째 인자에서 URL 추출 시도
                if let Some(args) = find_child_by_field(&node, "arguments") {
                    let mut cursor = args.walk();
                    if let Some(first_arg) = args.children(&mut cursor).nth(1) {
                        // ( 다음의 첫 인자
                        let arg_text = node_text(&first_arg, source);
                        let method = if func_text.contains(".get") {
                            "GET"
                        } else if func_text.contains(".post") {
                            "POST"
                        } else if func_text.contains(".put") {
                            "PUT"
                        } else if func_text.contains(".delete") {
                            "DELETE"
                        } else {
                            "GET"
                        };
                        apis.push(format!("{} {}", method, arg_text.trim_matches(&['"', '\'', '`'] as &[char])));
                    }
                }
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_api_patterns(child, source, apis);
    }
}

fn infer_component_type(file_path: &str, _name: &str) -> ComponentType {
    let path_lower = file_path.to_lowercase();
    if path_lower.contains("page") || path_lower.contains("views") || path_lower.contains("routes") {
        ComponentType::Page
    } else if path_lower.contains("layout") {
        ComponentType::Layout
    } else if path_lower.contains("util") || path_lower.contains("helper") || path_lower.contains("hoc") {
        ComponentType::Utility
    } else {
        ComponentType::Widget
    }
}
