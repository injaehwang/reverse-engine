use anyhow::Result;
use reverseng_core::types::analyzer::FunctionInfo;
use tree_sitter::Tree;

use super::{collect_nodes_by_kind, find_child_by_field, find_child_by_kind, node_text};

/// AST에서 함수 정의 추출
pub fn extract(tree: &Tree, source: &str, file_path: &str) -> Result<Vec<FunctionInfo>> {
    let mut functions = Vec::new();

    // function declarations, arrow functions, method definitions
    let func_kinds = [
        "function_declaration",
        "method_definition",
        "arrow_function",
        "function",
        // Python
        "function_definition",
    ];

    let nodes = collect_nodes_by_kind(tree, &func_kinds);

    for node in &nodes {
        let name = extract_function_name(node, source);
        if name.is_empty() {
            continue;
        }

        let is_async = is_async_function(node, source);
        let is_exported = is_exported(node, source);
        let params = extract_params(node, source);
        let return_type = extract_return_type(node, source);
        let calls = extract_function_calls(node, source);

        functions.push(FunctionInfo {
            name,
            file_path: file_path.to_string(),
            line_start: node.start_position().row + 1,
            line_end: node.end_position().row + 1,
            params,
            return_type,
            calls,
            called_by: vec![], // 후처리에서 채움
            is_async,
            is_exported,
        });
    }

    Ok(functions)
}

fn extract_function_name(node: &tree_sitter::Node, source: &str) -> String {
    // function_declaration / function_definition: name 필드
    if let Some(name_node) = find_child_by_field(node, "name") {
        return node_text(&name_node, source).to_string();
    }

    // method_definition: name 필드
    if node.kind() == "method_definition" {
        if let Some(name_node) = find_child_by_field(node, "name") {
            return node_text(&name_node, source).to_string();
        }
    }

    // arrow function — 부모가 variable_declarator이면 이름 추출
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

fn is_async_function(node: &tree_sitter::Node, source: &str) -> bool {
    let text = node_text(node, source);
    text.starts_with("async ")
        || node
            .parent()
            .is_some_and(|p| node_text(&p, source).starts_with("async "))
}

fn is_exported(node: &tree_sitter::Node, _source: &str) -> bool {
    node.parent().is_some_and(|p| {
        p.kind() == "export_statement" || p.kind() == "export_default_declaration"
    }) || {
        // const export: export const foo = ...
        node.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .is_some_and(|p| p.kind() == "export_statement")
    }
}

fn extract_params(node: &tree_sitter::Node, source: &str) -> Vec<String> {
    let params_node = find_child_by_field(node, "parameters")
        .or_else(|| find_child_by_kind(node, "formal_parameters"))
        .or_else(|| find_child_by_kind(node, "parameters"));

    let Some(params) = params_node else {
        return vec![];
    };

    let mut result = Vec::new();
    let mut cursor = params.walk();
    for child in params.children(&mut cursor) {
        match child.kind() {
            "required_parameter" | "optional_parameter" | "identifier" | "typed_parameter"
            | "default_parameter" | "typed_default_parameter" => {
                let text = node_text(&child, source).to_string();
                result.push(text);
            }
            _ => {}
        }
    }
    result
}

fn extract_return_type(node: &tree_sitter::Node, source: &str) -> Option<String> {
    find_child_by_field(node, "return_type")
        .map(|n| node_text(&n, source).trim_start_matches(':').trim().to_string())
}

/// 함수 본문에서 호출되는 다른 함수들 추출
fn extract_function_calls(node: &tree_sitter::Node, source: &str) -> Vec<String> {
    let mut calls = Vec::new();
    collect_calls_recursive(*node, source, &mut calls);
    calls.sort();
    calls.dedup();
    calls
}

fn collect_calls_recursive(node: tree_sitter::Node, source: &str, calls: &mut Vec<String>) {
    if node.kind() == "call_expression" {
        if let Some(func) = find_child_by_field(&node, "function") {
            let name = node_text(&func, source).to_string();
            // 메서드 호출에서 마지막 부분만 (a.b.c → c)
            let short_name = name.rsplit('.').next().unwrap_or(&name).to_string();
            if !short_name.is_empty() {
                calls.push(short_name);
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_calls_recursive(child, source, calls);
    }
}
