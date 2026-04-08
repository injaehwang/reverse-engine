use anyhow::Result;
use reverseng_core::types::analyzer::StateStoreInfo;
use tree_sitter::Tree;

use super::{collect_nodes_by_kind, find_child_by_field, node_text};

/// AST에서 상태 관리 스토어 패턴 추출
/// Redux (createSlice, createStore), Zustand (create), Pinia (defineStore), Recoil (atom, selector)
pub fn extract(tree: &Tree, source: &str, file_path: &str) -> Result<Vec<StateStoreInfo>> {
    let mut stores = Vec::new();

    let call_nodes = collect_nodes_by_kind(tree, &["call_expression"]);

    for node in &call_nodes {
        let func = match find_child_by_field(node, "function") {
            Some(f) => f,
            None => continue,
        };

        let func_text = node_text(&func, source);

        match func_text {
            // Redux Toolkit: createSlice({ name: '...', initialState: {...}, reducers: {...} })
            "createSlice" => {
                if let Some(store) = extract_redux_slice(node, source, file_path) {
                    stores.push(store);
                }
            }
            // Redux: createStore(reducer)
            "createStore" | "configureStore" => {
                if let Some(store) = extract_redux_store(node, source, file_path, func_text) {
                    stores.push(store);
                }
            }
            // Zustand: create((set) => ({ ... }))
            "create" => {
                if let Some(store) = extract_zustand_store(node, source, file_path) {
                    stores.push(store);
                }
            }
            // Pinia: defineStore('id', { state: () => ({...}), actions: {...} })
            "defineStore" => {
                if let Some(store) = extract_pinia_store(node, source, file_path) {
                    stores.push(store);
                }
            }
            // Recoil: atom({ key: '...', default: ... })
            "atom" => {
                if let Some(store) = extract_recoil_atom(node, source, file_path) {
                    stores.push(store);
                }
            }
            // Recoil: selector({ key: '...', get: ... })
            "selector" if source.contains("recoil") || source.contains("Recoil") => {
                if let Some(store) = extract_recoil_atom(node, source, file_path) {
                    stores.push(store);
                }
            }
            _ => {}
        }
    }

    Ok(stores)
}

/// Redux Toolkit createSlice 추출
fn extract_redux_slice(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
) -> Option<StateStoreInfo> {
    let args = find_child_by_field(node, "arguments")?;
    let obj = find_first_object(&args, source)?;

    let mut name = String::new();
    let mut state_keys = Vec::new();
    let mut actions = Vec::new();

    let mut cursor = obj.walk();
    for child in obj.children(&mut cursor) {
        if child.kind() != "pair" {
            continue;
        }
        let key = find_child_by_field(&child, "key")
            .map(|n| node_text(&n, source))?;
        let value = find_child_by_field(&child, "value")?;

        match key {
            "name" => {
                name = node_text(&value, source)
                    .trim_matches(&['"', '\''] as &[char])
                    .to_string();
            }
            "initialState" => {
                state_keys = extract_object_keys(&value, source);
            }
            "reducers" => {
                actions = extract_object_keys(&value, source);
            }
            _ => {}
        }
    }

    if name.is_empty() {
        name = find_variable_name(node, source).unwrap_or_else(|| "unknown".into());
    }

    Some(StateStoreInfo {
        name,
        store_type: "redux".to_string(),
        file_path: file_path.to_string(),
        state_keys,
        actions,
        used_in_components: vec![], // build_reverse_references에서 채움
    })
}

/// Redux createStore/configureStore 추출
fn extract_redux_store(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    func_text: &str,
) -> Option<StateStoreInfo> {
    let name = find_variable_name(node, source)
        .unwrap_or_else(|| "store".into());

    Some(StateStoreInfo {
        name,
        store_type: if func_text == "configureStore" {
            "redux-toolkit".to_string()
        } else {
            "redux".to_string()
        },
        file_path: file_path.to_string(),
        state_keys: vec![],
        actions: vec![],
        used_in_components: vec![],
    })
}

/// Zustand create() 추출
fn extract_zustand_store(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
) -> Option<StateStoreInfo> {
    let name = find_variable_name(node, source)
        .unwrap_or_else(|| "useStore".into());

    // create((set) => ({ count: 0, increment: () => ... }))
    let args = find_child_by_field(node, "arguments")?;
    // arrow function 내부의 반환 객체에서 state 키와 액션 추출
    let mut state_keys = Vec::new();
    let mut actions = Vec::new();

    // arrow function 내부의 반환 객체에서 키 추출
    let arrow_nodes = collect_nodes_by_kind_local(&args, &["arrow_function"]);
    for arrow in &arrow_nodes {
        // arrow function body가 객체이면 키 추출
        if let Some(body) = find_child_by_field(arrow, "body") {
            let obj_nodes = collect_nodes_by_kind_local(&body, &["object"]);
            if let Some(obj) = obj_nodes.first() {
                let keys = extract_object_keys(obj, source);
                for key in keys {
                    // AST 노드 종류로 함수 여부 판별
                    if is_function_value(obj, &key, source) {
                        actions.push(key);
                    } else {
                        state_keys.push(key);
                    }
                }
                break;
            }
        }
    }

    Some(StateStoreInfo {
        name,
        store_type: "zustand".to_string(),
        file_path: file_path.to_string(),
        state_keys,
        actions,
        used_in_components: vec![],
    })
}

/// Pinia defineStore 추출
fn extract_pinia_store(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
) -> Option<StateStoreInfo> {
    let args = find_child_by_field(node, "arguments")?;
    let mut cursor = args.walk();
    let children: Vec<_> = args.children(&mut cursor).collect();

    // 첫 번째 인자: store id (문자열)
    let name = children.get(1)
        .map(|n| node_text(n, source).trim_matches(&['"', '\''] as &[char]).to_string())
        .unwrap_or_else(|| find_variable_name(node, source).unwrap_or("store".into()));

    let mut state_keys = Vec::new();
    let mut actions = Vec::new();

    // 두 번째 인자: 옵션 객체에서 state/actions 추출
    if let Some(obj_node) = children.get(3) {
        if obj_node.kind() == "object" {
            let mut obj_cursor = obj_node.walk();
            for child in obj_node.children(&mut obj_cursor) {
                if child.kind() != "pair" {
                    continue;
                }
                let key = find_child_by_field(&child, "key")
                    .map(|n| node_text(&n, source));
                let value = find_child_by_field(&child, "value");

                match key {
                    Some("state") => {
                        // state: () => ({ ... }) — arrow function 내부 객체에서 키 추출
                        if let Some(val) = value {
                            let obj_nodes = collect_nodes_by_kind_local(&val, &["object"]);
                            if let Some(inner_obj) = obj_nodes.first() {
                                state_keys = extract_object_keys(inner_obj, source);
                            }
                        }
                    }
                    Some("actions") => {
                        if let Some(val) = value {
                            actions = extract_object_keys(&val, source);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    Some(StateStoreInfo {
        name,
        store_type: "pinia".to_string(),
        file_path: file_path.to_string(),
        state_keys,
        actions,
        used_in_components: vec![],
    })
}

/// Recoil atom/selector 추출
fn extract_recoil_atom(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
) -> Option<StateStoreInfo> {
    let args = find_child_by_field(node, "arguments")?;
    let obj = find_first_object(&args, source)?;

    let mut name = find_variable_name(node, source)
        .unwrap_or_else(|| "unknown".into());

    let mut cursor = obj.walk();
    for child in obj.children(&mut cursor) {
        if child.kind() == "pair" {
            if let Some(key) = find_child_by_field(&child, "key") {
                if node_text(&key, source) == "key" {
                    if let Some(val) = find_child_by_field(&child, "value") {
                        name = node_text(&val, source)
                            .trim_matches(&['"', '\''] as &[char])
                            .to_string();
                    }
                }
            }
        }
    }

    Some(StateStoreInfo {
        name,
        store_type: "recoil".to_string(),
        file_path: file_path.to_string(),
        state_keys: vec![],
        actions: vec![],
        used_in_components: vec![],
    })
}

// ============================================================
// 유틸리티
// ============================================================

/// 변수 선언자에서 변수명 추출 (const useStore = create(...))
fn find_variable_name(node: &tree_sitter::Node, source: &str) -> Option<String> {
    let parent = node.parent()?;
    if parent.kind() == "variable_declarator" {
        find_child_by_field(&parent, "name").map(|n| node_text(&n, source).to_string())
    } else {
        None
    }
}

/// 노드 하위에서 첫 번째 object 노드 찾기
fn find_first_object<'a>(
    node: &tree_sitter::Node<'a>,
    _source: &str,
) -> Option<tree_sitter::Node<'a>> {
    collect_nodes_by_kind_local(node, &["object"]).into_iter().next()
}

/// 객체의 키 목록 추출
fn extract_object_keys(obj: &tree_sitter::Node, source: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut cursor = obj.walk();
    for child in obj.children(&mut cursor) {
        if child.kind() == "pair" || child.kind() == "method_definition" || child.kind() == "shorthand_property_identifier" {
            if child.kind() == "shorthand_property_identifier" {
                keys.push(node_text(&child, source).to_string());
            } else if let Some(key_node) = find_child_by_field(&child, "name")
                .or_else(|| find_child_by_field(&child, "key"))
            {
                keys.push(node_text(&key_node, source).to_string());
            }
        }
    }
    keys
}

/// 객체의 특정 키의 값이 함수(arrow_function, function 등)인지 확인
fn is_function_value(
    obj: &tree_sitter::Node,
    key_name: &str,
    source: &str,
) -> bool {
    let mut cursor = obj.walk();
    for child in obj.children(&mut cursor) {
        if child.kind() == "pair" {
            if let Some(key) = find_child_by_field(&child, "key") {
                if node_text(&key, source) == key_name {
                    if let Some(value) = find_child_by_field(&child, "value") {
                        return matches!(
                            value.kind(),
                            "arrow_function" | "function" | "function_expression"
                        );
                    }
                }
            }
        }
    }
    false
}

/// 객체에서 특정 키의 값 텍스트 추출
fn find_pair_value<'a>(
    obj: &tree_sitter::Node<'a>,
    key_name: &str,
    source: &'a str,
) -> Option<&'a str> {
    let mut cursor = obj.walk();
    for child in obj.children(&mut cursor) {
        if child.kind() == "pair" {
            if let Some(key) = find_child_by_field(&child, "key") {
                if node_text(&key, source) == key_name {
                    return find_child_by_field(&child, "value")
                        .map(|v| node_text(&v, source));
                }
            }
        }
    }
    None
}

/// 특정 노드 하위에서 종류별 노드 수집 (로컬 버전, Tree 불필요)
fn collect_nodes_by_kind_local<'a>(
    node: &tree_sitter::Node<'a>,
    kinds: &[&str],
) -> Vec<tree_sitter::Node<'a>> {
    let mut result = Vec::new();
    fn recurse<'a>(n: tree_sitter::Node<'a>, kinds: &[&str], result: &mut Vec<tree_sitter::Node<'a>>) {
        if kinds.contains(&n.kind()) {
            result.push(n);
        }
        let mut cursor = n.walk();
        for child in n.children(&mut cursor) {
            recurse(child, kinds, result);
        }
    }
    recurse(*node, kinds, &mut result);
    result
}
