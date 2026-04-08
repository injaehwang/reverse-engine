use reverseng_core::types::analyzer::AnalysisResult;
use serde::{Deserialize, Serialize};

/// Dead code 탐지 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeadCodeReport {
    pub unused_components: Vec<UnusedItem>,
    pub unused_functions: Vec<UnusedItem>,
    pub unreachable_routes: Vec<UnreachableRoute>,
    pub summary: DeadCodeSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnusedItem {
    pub name: String,
    pub file_path: String,
    pub line_start: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnreachableRoute {
    pub path: String,
    pub component: String,
    pub file_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeadCodeSummary {
    pub unused_components: usize,
    pub unused_functions: usize,
    pub unreachable_routes: usize,
    pub total: usize,
}

/// 분석 결과에서 dead code를 탐지
pub fn detect_dead_code(analysis: &AnalysisResult) -> DeadCodeReport {
    let unused_components = find_unused_components(analysis);
    let unused_functions = find_unused_functions(analysis);
    let unreachable_routes = find_unreachable_routes(analysis);

    let summary = DeadCodeSummary {
        unused_components: unused_components.len(),
        unused_functions: unused_functions.len(),
        unreachable_routes: unreachable_routes.len(),
        total: unused_components.len() + unused_functions.len() + unreachable_routes.len(),
    };

    DeadCodeReport {
        unused_components,
        unused_functions,
        unreachable_routes,
        summary,
    }
}

/// used_by가 비어있고, 라우트에도 매핑되지 않은 컴포넌트
fn find_unused_components(analysis: &AnalysisResult) -> Vec<UnusedItem> {
    let route_components: std::collections::HashSet<&str> = analysis
        .routes
        .iter()
        .map(|r| r.component.trim_start_matches('<').trim_end_matches("/>").trim_end_matches('>').trim())
        .collect();

    analysis
        .components
        .iter()
        .filter(|c| {
            c.used_by.is_empty()
                && !route_components.contains(c.name.as_str())
                // App 컴포넌트는 루트이므로 used_by가 없는 게 정상
                && c.name != "App"
        })
        .map(|c| UnusedItem {
            name: c.name.clone(),
            file_path: c.file_path.clone(),
            line_start: c.line_start,
            reason: "다른 컴포넌트에서 참조되지 않고, 라우트에도 매핑되지 않음".to_string(),
        })
        .collect()
}

/// called_by가 비어있고, exported이며, 컴포넌트가 아닌 함수
fn find_unused_functions(analysis: &AnalysisResult) -> Vec<UnusedItem> {
    let component_names: std::collections::HashSet<&str> = analysis
        .components
        .iter()
        .map(|c| c.name.as_str())
        .collect();

    analysis
        .functions
        .iter()
        .filter(|f| {
            f.called_by.is_empty()
                && f.is_exported
                // 컴포넌트 함수 자체는 제외 (컴포넌트 used_by로 추적)
                && !component_names.contains(f.name.as_str())
                // main, index, setup 등 진입점 함수 제외
                && !is_entry_point(&f.name)
        })
        .map(|f| UnusedItem {
            name: f.name.clone(),
            file_path: f.file_path.clone(),
            line_start: f.line_start,
            reason: "exported 되었으나 다른 함수에서 호출되지 않음".to_string(),
        })
        .collect()
}

/// 라우트에 매핑된 컴포넌트가 실제로 존재하지 않는 경우
fn find_unreachable_routes(analysis: &AnalysisResult) -> Vec<UnreachableRoute> {
    let component_names: std::collections::HashSet<&str> = analysis
        .components
        .iter()
        .map(|c| c.name.as_str())
        .collect();

    analysis
        .routes
        .iter()
        .filter(|r| {
            let comp_name = r.component
                .trim_start_matches('<')
                .trim_end_matches("/>")
                .trim_end_matches('>')
                .trim();
            !comp_name.is_empty() && !component_names.contains(comp_name)
        })
        .map(|r| UnreachableRoute {
            path: r.path.clone(),
            component: r.component.clone(),
            file_path: r.file_path.clone(),
            reason: format!("컴포넌트 '{}'가 분석 결과에 존재하지 않음", r.component),
        })
        .collect()
}

fn is_entry_point(name: &str) -> bool {
    matches!(
        name,
        "main" | "index" | "setup" | "init" | "bootstrap" | "configure" | "register"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use reverseng_core::types::analyzer::*;

    #[test]
    fn detects_unused_component() {
        let analysis = AnalysisResult {
            source_path: "test".into(),
            framework: DetectedFramework::React,
            components: vec![
                ComponentInfo {
                    name: "App".into(),
                    file_path: "src/App.tsx".into(),
                    line_start: 1, line_end: 10,
                    component_type: ComponentType::Widget,
                    props: vec![], children: vec!["Dashboard".into()],
                    used_by: vec![], hooks: vec![], api_calls: vec![],
                },
                ComponentInfo {
                    name: "Dashboard".into(),
                    file_path: "src/Dashboard.tsx".into(),
                    line_start: 1, line_end: 10,
                    component_type: ComponentType::Page,
                    props: vec![], children: vec![],
                    used_by: vec!["App".into()], hooks: vec![], api_calls: vec![],
                },
                ComponentInfo {
                    name: "Orphan".into(),
                    file_path: "src/Orphan.tsx".into(),
                    line_start: 1, line_end: 10,
                    component_type: ComponentType::Widget,
                    props: vec![], children: vec![],
                    used_by: vec![], hooks: vec![], api_calls: vec![],
                },
            ],
            routes: vec![RouteInfo {
                path: "/".into(),
                component: "<Dashboard />".into(),
                file_path: "src/App.tsx".into(),
                guards: vec![], children: vec![], meta: None,
            }],
            functions: vec![],
            api_clients: vec![],
            state_stores: vec![],
            dependencies: vec![],
        };

        let report = detect_dead_code(&analysis);
        assert_eq!(report.unused_components.len(), 1);
        assert_eq!(report.unused_components[0].name, "Orphan");
    }

    #[test]
    fn app_component_is_never_flagged() {
        let analysis = AnalysisResult {
            source_path: "test".into(),
            framework: DetectedFramework::React,
            components: vec![
                ComponentInfo {
                    name: "App".into(),
                    file_path: "src/App.tsx".into(),
                    line_start: 1, line_end: 10,
                    component_type: ComponentType::Widget,
                    props: vec![], children: vec![],
                    used_by: vec![], hooks: vec![], api_calls: vec![],
                },
            ],
            routes: vec![],
            functions: vec![],
            api_clients: vec![],
            state_stores: vec![],
            dependencies: vec![],
        };

        let report = detect_dead_code(&analysis);
        assert!(report.unused_components.is_empty(), "App은 루트 컴포넌트로 unused 처리하면 안 됨");
    }

    #[test]
    fn route_mapped_component_not_flagged() {
        let analysis = AnalysisResult {
            source_path: "test".into(),
            framework: DetectedFramework::React,
            components: vec![
                ComponentInfo {
                    name: "Settings".into(),
                    file_path: "src/Settings.tsx".into(),
                    line_start: 1, line_end: 10,
                    component_type: ComponentType::Page,
                    props: vec![], children: vec![],
                    used_by: vec![], hooks: vec![], api_calls: vec![],
                },
            ],
            routes: vec![RouteInfo {
                path: "/settings".into(),
                component: "<Settings />".into(),
                file_path: "src/App.tsx".into(),
                guards: vec![], children: vec![], meta: None,
            }],
            functions: vec![],
            api_clients: vec![],
            state_stores: vec![],
            dependencies: vec![],
        };

        let report = detect_dead_code(&analysis);
        assert!(report.unused_components.is_empty(), "라우트에 매핑된 컴포넌트는 unused가 아님");
    }

    #[test]
    fn detects_unused_exported_function() {
        let analysis = AnalysisResult {
            source_path: "test".into(),
            framework: DetectedFramework::React,
            components: vec![],
            routes: vec![],
            functions: vec![
                FunctionInfo {
                    name: "helperFn".into(),
                    file_path: "src/utils.ts".into(),
                    line_start: 1, line_end: 5,
                    params: vec![], return_type: None,
                    calls: vec![], called_by: vec![],
                    is_async: false, is_exported: true,
                },
                FunctionInfo {
                    name: "usedFn".into(),
                    file_path: "src/utils.ts".into(),
                    line_start: 7, line_end: 10,
                    params: vec![], return_type: None,
                    calls: vec![], called_by: vec!["App".into()],
                    is_async: false, is_exported: true,
                },
            ],
            api_clients: vec![],
            state_stores: vec![],
            dependencies: vec![],
        };

        let report = detect_dead_code(&analysis);
        assert_eq!(report.unused_functions.len(), 1);
        assert_eq!(report.unused_functions[0].name, "helperFn");
    }
}
