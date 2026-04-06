use serde::{Deserialize, Serialize};

/// 코드 분석 전체 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub source_path: String,
    pub framework: DetectedFramework,
    pub components: Vec<ComponentInfo>,
    pub routes: Vec<RouteInfo>,
    pub functions: Vec<FunctionInfo>,
    pub api_clients: Vec<ApiClientCall>,
    pub state_stores: Vec<StateStoreInfo>,
    pub dependencies: Vec<DependencyInfo>,
}

/// 감지된 프레임워크
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DetectedFramework {
    React,
    NextJs,
    Vue,
    Nuxt,
    Angular,
    Svelte,
    Python,
    Unknown,
}

/// 컴포넌트 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentInfo {
    pub name: String,
    pub file_path: String,
    pub line_start: usize,
    pub line_end: usize,
    pub component_type: ComponentType,
    pub props: Vec<PropInfo>,
    pub children: Vec<String>,
    pub used_by: Vec<String>,
    pub hooks: Vec<String>,
    pub api_calls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComponentType {
    Page,
    Layout,
    Widget,
    Utility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropInfo {
    pub name: String,
    pub prop_type: String,
    pub required: bool,
    pub default_value: Option<String>,
}

/// 라우트 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteInfo {
    pub path: String,
    pub component: String,
    pub file_path: String,
    pub guards: Vec<String>,
    pub children: Vec<RouteInfo>,
    pub meta: Option<serde_json::Value>,
}

/// 함수 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub file_path: String,
    pub line_start: usize,
    pub line_end: usize,
    pub params: Vec<String>,
    pub return_type: Option<String>,
    pub calls: Vec<String>,
    pub called_by: Vec<String>,
    pub is_async: bool,
    pub is_exported: bool,
}

/// API 클라이언트 호출 (소스코드에서 추출)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiClientCall {
    pub method: String,
    pub url_pattern: String,
    pub file_path: String,
    pub line: usize,
    pub function_name: String,
}

/// 상태 관리 스토어 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateStoreInfo {
    pub name: String,
    pub store_type: String, // redux, vuex, zustand, pinia, etc.
    pub file_path: String,
    pub state_keys: Vec<String>,
    pub actions: Vec<String>,
    pub used_in_components: Vec<String>,
}

/// 의존성 패키지 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyInfo {
    pub name: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub dep_type: DependencyType,
    pub license: Option<String>,
    pub vulnerabilities: Vec<VulnerabilityInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DependencyType {
    Production,
    Development,
    Peer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VulnerabilityInfo {
    pub severity: String,
    pub title: String,
    pub cve: Option<String>,
    pub advisory_url: Option<String>,
}
