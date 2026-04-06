use serde::{Deserialize, Serialize};

/// 관계 그래프 노드 종류
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum NodeType {
    Page,
    Component,
    Function,
    ApiEndpoint,
    StateStore,
    Route,
}

/// 그래프 노드
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub node_type: NodeType,
    pub label: String,
    pub file_path: Option<String>,
    pub url: Option<String>,
    pub metadata: serde_json::Value,
}

/// 관계 종류
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EdgeType {
    NavigatesTo,
    Contains,
    Triggers,
    Calls,
    Returns,
    RenderedBy,
    Imports,
    Uses,
    ModifiesState,
}

/// 그래프 엣지
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from_id: String,
    pub to_id: String,
    pub edge_type: EdgeType,
    pub label: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// 전체 관계 그래프
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// 화면 흐름 엔트리 (Excel Sheet 3용)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenFlow {
    pub from_url: String,
    pub trigger_element: String,
    pub action: String,
    pub to_url: String,
    pub condition: Option<String>,
}

/// 이벤트 체인 (버튼 클릭 → 함수 → API → 상태변경)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventChain {
    pub trigger: String,
    pub trigger_selector: String,
    pub page_url: String,
    pub steps: Vec<EventStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventStep {
    pub step_type: EventStepType,
    pub name: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventStepType {
    FunctionCall,
    ApiRequest,
    StateChange,
    Navigation,
    DomUpdate,
}
