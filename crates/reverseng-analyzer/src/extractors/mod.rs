pub mod api_call;
pub mod component;
pub mod dependency;
pub mod function;
pub mod route;
pub mod state;

use tree_sitter::{Node, Tree};

/// AST에서 특정 종류의 노드를 재귀적으로 수집
pub fn collect_nodes_by_kind<'a>(tree: &'a Tree, kinds: &[&str]) -> Vec<Node<'a>> {
    let mut nodes = Vec::new();
    collect_recursive(tree.root_node(), kinds, &mut nodes);
    nodes
}

fn collect_recursive<'a>(node: Node<'a>, kinds: &[&str], result: &mut Vec<Node<'a>>) {
    if kinds.contains(&node.kind()) {
        result.push(node);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_recursive(child, kinds, result);
    }
}

/// 노드의 텍스트를 소스에서 추출
pub fn node_text<'a>(node: &Node, source: &'a str) -> &'a str {
    &source[node.start_byte()..node.end_byte()]
}

/// 노드의 자식 중 특정 종류를 찾기
pub fn find_child_by_kind<'a>(node: &Node<'a>, kind: &str) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    node.children(&mut cursor).find(|c| c.kind() == kind)
}

/// 노드의 자식 중 특정 field_name을 찾기
pub fn find_child_by_field<'a>(node: &Node<'a>, field: &str) -> Option<Node<'a>> {
    node.child_by_field_name(field)
}
