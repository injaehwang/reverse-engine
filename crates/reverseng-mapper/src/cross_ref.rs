use reverseng_core::types::analyzer::AnalysisResult;
use reverseng_core::types::crawler::CrawlResult;
use serde::{Deserialize, Serialize};

/// 교차 검증 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossRefReport {
    /// 코드에서 발견되고 크롤링에서도 확인된 API
    pub matched_apis: Vec<ApiMatch>,
    /// 코드에만 있고 크롤링에서 미확인된 API
    pub code_only_apis: Vec<CodeOnlyApi>,
    /// 크롤링에서만 발견되고 코드에서 미확인된 API
    pub crawl_only_apis: Vec<CrawlOnlyApi>,
    /// 커버리지 경고
    pub warnings: Vec<String>,
    /// 요약 통계
    pub summary: CoverageSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiMatch {
    pub method: String,
    pub url_pattern: String,
    pub code_file: String,
    pub code_function: String,
    pub observed_urls: Vec<String>,
    pub observed_status_codes: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeOnlyApi {
    pub method: String,
    pub url_pattern: String,
    pub file_path: String,
    pub function_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlOnlyApi {
    pub method: String,
    pub url: String,
    pub observed_on_pages: Vec<String>,
    pub status_code: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageSummary {
    pub total_code_apis: usize,
    pub total_crawl_apis: usize,
    pub matched_count: usize,
    pub code_only_count: usize,
    pub crawl_only_count: usize,
    pub coverage_percent: f64,
}

/// 크롤링 결과와 코드 분석 결과를 교차 검증
pub fn cross_reference(
    crawl: &CrawlResult,
    analysis: &AnalysisResult,
) -> CrossRefReport {
    let mut matched = Vec::new();
    let mut code_only = Vec::new();
    let mut crawl_only = Vec::new();
    let mut warnings = Vec::new();

    // 크롤링에서 관찰된 모든 API 호출 수집 (중복 제거)
    let mut observed_apis: Vec<(String, String, Vec<String>, Vec<u16>)> = Vec::new(); // (method, url, pages, statuses)

    for page in &crawl.pages {
        for call in &page.api_calls {
            let normalized_url = normalize_api_url(&call.url);
            if let Some(existing) = observed_apis.iter_mut().find(|(m, u, _, _)| {
                m == &call.method && u == &normalized_url
            }) {
                if !existing.2.contains(&page.url) {
                    existing.2.push(page.url.clone());
                }
                if !existing.3.contains(&call.response_status) {
                    existing.3.push(call.response_status);
                }
            } else {
                observed_apis.push((
                    call.method.clone(),
                    normalized_url,
                    vec![page.url.clone()],
                    vec![call.response_status],
                ));
            }
        }
    }

    // 코드 분석의 API와 크롤링 API 매칭
    let mut matched_crawl_indices = std::collections::HashSet::new();

    for code_api in &analysis.api_clients {
        let mut all_observed_urls = Vec::new();
        let mut all_status_codes = Vec::new();
        let mut found_any = false;

        for (idx, (method, url, pages, statuses)) in observed_apis.iter().enumerate() {
            if method == &code_api.method && url_pattern_matches(&code_api.url_pattern, url) {
                matched_crawl_indices.insert(idx);
                found_any = true;
                // 같은 패턴에 매칭되는 모든 관찰 URL을 수집
                for p in pages {
                    if !all_observed_urls.contains(p) {
                        all_observed_urls.push(p.clone());
                    }
                }
                for s in statuses {
                    if !all_status_codes.contains(s) {
                        all_status_codes.push(*s);
                    }
                }
            }
        }

        if found_any {
            matched.push(ApiMatch {
                method: code_api.method.clone(),
                url_pattern: code_api.url_pattern.clone(),
                code_file: code_api.file_path.clone(),
                code_function: code_api.function_name.clone(),
                observed_urls: all_observed_urls,
                observed_status_codes: all_status_codes,
            });
        } else {
            code_only.push(CodeOnlyApi {
                method: code_api.method.clone(),
                url_pattern: code_api.url_pattern.clone(),
                file_path: code_api.file_path.clone(),
                function_name: code_api.function_name.clone(),
            });
        }
    }

    // 크롤링에서만 발견된 API
    for (idx, (method, url, pages, statuses)) in observed_apis.iter().enumerate() {
        if !matched_crawl_indices.contains(&idx) {
            crawl_only.push(CrawlOnlyApi {
                method: method.clone(),
                url: url.clone(),
                observed_on_pages: pages.clone(),
                status_code: *statuses.first().unwrap_or(&0),
            });
        }
    }

    // 커버리지 경고 생성
    if !code_only.is_empty() {
        warnings.push(format!(
            "코드에서 발견된 {}개 API가 크롤링 중 호출되지 않았습니다. \
            크롤링 범위가 제한적이거나, 특정 조건에서만 호출되는 API일 수 있습니다.",
            code_only.len()
        ));
    }

    if !crawl_only.is_empty() {
        warnings.push(format!(
            "크롤링에서 {}개 API가 발견되었으나 소스코드에서 직접 호출 패턴을 찾지 못했습니다. \
            동적으로 구성된 URL이거나, 서드파티 라이브러리를 통한 호출일 수 있습니다.",
            crawl_only.len()
        ));
    }

    warnings.push(
        "이 보고서는 크롤링 시점에 도달 가능한 화면에서 발생한 API 호출만 포함합니다. \
        전체 API의 일부일 수 있습니다.".to_string()
    );

    let total_code = analysis.api_clients.len();
    let total_crawl = observed_apis.len();
    let matched_count = matched.len();
    let coverage = if total_code > 0 {
        (matched_count as f64 / total_code as f64) * 100.0
    } else {
        0.0
    };

    CrossRefReport {
        matched_apis: matched,
        code_only_apis: code_only,
        crawl_only_apis: crawl_only,
        warnings,
        summary: CoverageSummary {
            total_code_apis: total_code,
            total_crawl_apis: total_crawl,
            matched_count,
            code_only_count: total_code - matched_count,
            crawl_only_count: total_crawl - matched_crawl_indices.len(),
            coverage_percent: (coverage * 10.0).round() / 10.0,
        },
    }
}

/// API URL 정규화: base URL 제거, 쿼리 파라미터 제거
fn normalize_api_url(url: &str) -> String {
    let url = if let Ok(parsed) = url::Url::parse(url) {
        parsed.path().to_string()
    } else {
        url.to_string()
    };
    // 트레일링 슬래시 제거
    url.trim_end_matches('/').to_string()
}

/// 코드의 URL 패턴이 실제 URL과 매칭되는지 확인
/// /api/users/{userId} → /api/users/123 과 매칭
fn url_pattern_matches(pattern: &str, actual: &str) -> bool {
    let pattern_parts: Vec<&str> = pattern.trim_matches('/').split('/').collect();
    let actual_parts: Vec<&str> = actual.trim_matches('/').split('/').collect();

    if pattern_parts.len() != actual_parts.len() {
        return false;
    }

    for (p, a) in pattern_parts.iter().zip(actual_parts.iter()) {
        // 동적 세그먼트: {param} 또는 :param
        if p.starts_with('{') && p.ends_with('}') {
            continue; // 아무 값이나 매칭
        }
        if p.starts_with(':') {
            continue;
        }
        if p != a {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_pattern_matches() {
        assert!(url_pattern_matches("/api/users", "/api/users"));
        assert!(url_pattern_matches("/api/users/{id}", "/api/users/123"));
        assert!(url_pattern_matches("/api/users/{id}/profile", "/api/users/456/profile"));
        assert!(!url_pattern_matches("/api/users/{id}", "/api/posts/123"));
        assert!(!url_pattern_matches("/api/users", "/api/users/123"));
    }

    #[test]
    fn test_url_pattern_matches_colon_params() {
        assert!(url_pattern_matches("/api/users/:id", "/api/users/123"));
        assert!(url_pattern_matches("/api/:category/:id", "/api/books/42"));
    }

    #[test]
    fn test_url_pattern_matches_edge_cases() {
        assert!(url_pattern_matches("/", "/"));
        assert!(!url_pattern_matches("/api/users/{id}", "/api/users/123/extra"));
        assert!(!url_pattern_matches("/api/users/{id}/profile", "/api/users/123"));
    }

    #[test]
    fn test_normalize_api_url() {
        assert_eq!(normalize_api_url("https://example.com/api/stats"), "/api/stats");
        assert_eq!(normalize_api_url("/api/stats/"), "/api/stats");
        assert_eq!(normalize_api_url("/api/stats"), "/api/stats");
    }

    #[test]
    fn test_normalize_api_url_with_query() {
        assert_eq!(normalize_api_url("https://example.com/api/stats?page=1"), "/api/stats");
        assert_eq!(normalize_api_url("http://localhost:3000/api/data"), "/api/data");
    }
}
