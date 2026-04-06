use anyhow::Result;
use reverseng_core::types::analyzer::ApiClientCall;
use tree_sitter::Tree;

use super::{collect_nodes_by_kind, find_child_by_field, node_text};

/// AST에서 API 클라이언트 호출 추출 (fetch, axios, $http 등)
pub fn extract(tree: &Tree, source: &str, file_path: &str) -> Result<Vec<ApiClientCall>> {
    let mut api_calls = Vec::new();

    let call_nodes = collect_nodes_by_kind(tree, &["call_expression"]);

    for node in &call_nodes {
        let func = match find_child_by_field(node, "function") {
            Some(f) => f,
            None => continue,
        };

        let func_text = node_text(&func, source);

        // fetch() 호출
        if func_text == "fetch" {
            if let Some(call) = extract_fetch_call(node, source, file_path) {
                api_calls.push(call);
            }
            continue;
        }

        // axios.get/post/put/delete/patch
        if func_text.starts_with("axios.") || func_text.starts_with("this.$http.") || func_text.starts_with("api.") {
            if let Some(call) = extract_axios_call(node, &func_text, source, file_path) {
                api_calls.push(call);
            }
            continue;
        }

        // Python: requests.get/post
        if func_text.starts_with("requests.") {
            if let Some(call) = extract_axios_call(node, &func_text, source, file_path) {
                api_calls.push(call);
            }
        }
    }

    Ok(api_calls)
}

fn extract_fetch_call(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
) -> Option<ApiClientCall> {
    let args = find_child_by_field(node, "arguments")?;
    let mut cursor = args.walk();
    let children: Vec<_> = args.children(&mut cursor).collect();

    // 첫 번째 인자 = URL
    let url_node = children.get(1)?; // 0번은 '('
    let url_pattern = node_text(url_node, source)
        .trim_matches(&['"', '\'', '`'] as &[char])
        .to_string();

    // 두 번째 인자에서 method 추출
    let method = if children.len() > 3 {
        let options_text = node_text(&children[3], source);
        if options_text.contains("POST") {
            "POST"
        } else if options_text.contains("PUT") {
            "PUT"
        } else if options_text.contains("DELETE") {
            "DELETE"
        } else if options_text.contains("PATCH") {
            "PATCH"
        } else {
            "GET"
        }
    } else {
        "GET"
    };

    let function_name = find_enclosing_function_name(node, source);

    Some(ApiClientCall {
        method: method.to_string(),
        url_pattern,
        file_path: file_path.to_string(),
        line: node.start_position().row + 1,
        function_name,
    })
}

fn extract_axios_call(
    node: &tree_sitter::Node,
    func_text: &str,
    source: &str,
    file_path: &str,
) -> Option<ApiClientCall> {
    let method_part = func_text.rsplit('.').next()?;
    let method = match method_part {
        "get" => "GET",
        "post" => "POST",
        "put" => "PUT",
        "delete" => "DELETE",
        "patch" => "PATCH",
        "head" => "HEAD",
        "options" => "OPTIONS",
        _ => return None,
    };

    let args = find_child_by_field(node, "arguments")?;
    let mut cursor = args.walk();
    let children: Vec<_> = args.children(&mut cursor).collect();

    let url_node = children.get(1)?;
    let url_pattern = node_text(url_node, source)
        .trim_matches(&['"', '\'', '`'] as &[char])
        .to_string();

    let function_name = find_enclosing_function_name(node, source);

    Some(ApiClientCall {
        method: method.to_string(),
        url_pattern,
        file_path: file_path.to_string(),
        line: node.start_position().row + 1,
        function_name,
    })
}

/// 가장 가까운 함수 이름 찾기 (위로 탐색)
fn find_enclosing_function_name(node: &tree_sitter::Node, source: &str) -> String {
    let mut current = node.parent();
    while let Some(parent) = current {
        match parent.kind() {
            "function_declaration" | "method_definition" | "function_definition" => {
                if let Some(name_node) = find_child_by_field(&parent, "name") {
                    return node_text(&name_node, source).to_string();
                }
            }
            "arrow_function" | "function" => {
                if let Some(grandparent) = parent.parent() {
                    if grandparent.kind() == "variable_declarator" {
                        if let Some(name_node) = find_child_by_field(&grandparent, "name") {
                            return node_text(&name_node, source).to_string();
                        }
                    }
                }
            }
            _ => {}
        }
        current = parent.parent();
    }
    "<anonymous>".to_string()
}
