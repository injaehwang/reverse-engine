use serde::{Deserialize, Serialize};

/// 크롤링 전체 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlResult {
    pub target_url: String,
    pub pages: Vec<PageInfo>,
    pub api_endpoints: Vec<ApiEndpoint>,
    pub timestamp: String,
}

/// 개별 페이지 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub url: String,
    pub title: String,
    pub screenshot_path: Option<String>,
    pub elements: PageElements,
    pub api_calls: Vec<ApiCall>,
    pub navigates_to: Vec<String>,
    pub auth_required: bool,
}

/// 페이지 내 요소들
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageElements {
    pub links: Vec<LinkElement>,
    pub buttons: Vec<ButtonElement>,
    pub forms: Vec<FormElement>,
    pub inputs: Vec<InputElement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkElement {
    pub text: String,
    pub href: String,
    pub selector: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ButtonElement {
    pub text: String,
    pub selector: String,
    pub event_handler: Option<String>,
    pub navigates_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormElement {
    pub id: Option<String>,
    pub action: Option<String>,
    pub method: String,
    pub fields: Vec<FormField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormField {
    pub name: String,
    pub field_type: String,
    pub required: bool,
    pub placeholder: Option<String>,
    pub validation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputElement {
    pub name: String,
    pub input_type: String,
    pub selector: String,
}

/// API 호출 정보 (네트워크 인터셉트)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiCall {
    pub method: String,
    pub url: String,
    pub request_body: Option<serde_json::Value>,
    pub response_status: u16,
    pub response_body: Option<serde_json::Value>,
    pub triggered_by: Option<String>,
}

/// API 엔드포인트 (고유 목록)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEndpoint {
    pub method: String,
    pub path: String,
    pub request_schema: Option<serde_json::Value>,
    pub response_schema: Option<serde_json::Value>,
    pub called_from_pages: Vec<String>,
}
