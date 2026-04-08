use reverseng_core::types::analyzer::AnalysisResult;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

/// 변경 영향도 분석 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactReport {
    /// 변경 대상
    pub target: String,
    pub target_type: String,
    /// 직접 영향받는 항목
    pub direct_impacts: Vec<ImpactItem>,
    /// 간접 영향받는 항목 (전파)
    pub transitive_impacts: Vec<ImpactItem>,
    /// 영향받는 라우트/화면
    pub affected_routes: Vec<String>,
    /// 영향받는 API 호출
    pub affected_apis: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactItem {
    pub name: String,
    pub item_type: String, // component, function, route
    pub file_path: String,
    pub relation: String, // "uses", "called_by", "imports"
    pub depth: usize,     // 전파 깊이 (1 = 직접, 2+ = 간접)
}

/// 특정 컴포넌트/함수를 변경했을 때 영향받는 범위 분석
pub fn analyze_impact(
    target_name: &str,
    analysis: &AnalysisResult,
) -> ImpactReport {
    // 역방향 그래프 구축: X가 변경되면 X를 사용하는 곳이 영향받음
    let mut reverse_deps: HashMap<String, Vec<(String, String, String)>> = HashMap::new(); // name → [(dependent, type, file)]

    // 컴포넌트: used_by 관계
    for comp in &analysis.components {
        for user in &comp.used_by {
            reverse_deps
                .entry(comp.name.clone())
                .or_default()
                .push((user.clone(), "component".into(), comp.file_path.clone()));
        }
    }

    // 함수: called_by 관계
    for func in &analysis.functions {
        for caller in &func.called_by {
            reverse_deps
                .entry(func.name.clone())
                .or_default()
                .push((caller.clone(), "function".into(), func.file_path.clone()));
        }
    }

    // BFS로 영향 전파 추적
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let mut direct = Vec::new();
    let mut transitive = Vec::new();

    visited.insert(target_name.to_string());
    queue.push_back((target_name.to_string(), 0usize));

    while let Some((current, depth)) = queue.pop_front() {
        if let Some(dependents) = reverse_deps.get(&current) {
            for (dep_name, dep_type, dep_file) in dependents {
                if visited.contains(dep_name) {
                    continue;
                }
                visited.insert(dep_name.clone());

                let item = ImpactItem {
                    name: dep_name.clone(),
                    item_type: dep_type.clone(),
                    file_path: dep_file.clone(),
                    relation: if depth == 0 { "직접 사용".into() } else { "간접 전파".into() },
                    depth: depth + 1,
                };

                if depth == 0 {
                    direct.push(item);
                } else {
                    transitive.push(item);
                }

                queue.push_back((dep_name.clone(), depth + 1));
            }
        }
    }

    // 영향받는 라우트 찾기
    let affected_routes: Vec<String> = analysis
        .routes
        .iter()
        .filter(|r| {
            let comp = r.component
                .trim_start_matches('<')
                .trim_end_matches("/>")
                .trim_end_matches('>')
                .trim();
            visited.contains(comp)
        })
        .map(|r| r.path.clone())
        .collect();

    // 영향받는 API 호출 찾기
    let affected_apis: Vec<String> = analysis
        .api_clients
        .iter()
        .filter(|a| visited.contains(&a.function_name))
        .map(|a| format!("{} {}", a.method, a.url_pattern))
        .collect();

    let target_type = if analysis.components.iter().any(|c| c.name == target_name) {
        "component"
    } else if analysis.functions.iter().any(|f| f.name == target_name) {
        "function"
    } else {
        "unknown"
    };

    ImpactReport {
        target: target_name.to_string(),
        target_type: target_type.to_string(),
        direct_impacts: direct,
        transitive_impacts: transitive,
        affected_routes,
        affected_apis,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reverseng_core::types::analyzer::*;

    fn sample_analysis() -> AnalysisResult {
        AnalysisResult {
            source_path: "test".into(),
            framework: DetectedFramework::React,
            components: vec![
                ComponentInfo {
                    name: "App".into(), file_path: "App.tsx".into(),
                    line_start: 1, line_end: 10, component_type: ComponentType::Widget,
                    props: vec![], children: vec!["Dashboard".into()],
                    used_by: vec![], hooks: vec![], api_calls: vec![],
                },
                ComponentInfo {
                    name: "Dashboard".into(), file_path: "Dashboard.tsx".into(),
                    line_start: 1, line_end: 10, component_type: ComponentType::Page,
                    props: vec![], children: vec!["StatsCard".into()],
                    used_by: vec!["App".into()], hooks: vec![], api_calls: vec![],
                },
                ComponentInfo {
                    name: "StatsCard".into(), file_path: "StatsCard.tsx".into(),
                    line_start: 1, line_end: 10, component_type: ComponentType::Widget,
                    props: vec![], children: vec![],
                    used_by: vec!["Dashboard".into()], hooks: vec![], api_calls: vec![],
                },
            ],
            routes: vec![RouteInfo {
                path: "/".into(), component: "<Dashboard />".into(),
                file_path: "App.tsx".into(), guards: vec![], children: vec![], meta: None,
            }],
            functions: vec![],
            api_clients: vec![],
            state_stores: vec![],
            dependencies: vec![],
        }
    }

    #[test]
    fn impact_propagates_upward() {
        let analysis = sample_analysis();
        let report = analyze_impact("StatsCard", &analysis);

        // StatsCard → Dashboard (직접) → App (간접)
        assert_eq!(report.direct_impacts.len(), 1);
        assert_eq!(report.direct_impacts[0].name, "Dashboard");

        assert_eq!(report.transitive_impacts.len(), 1);
        assert_eq!(report.transitive_impacts[0].name, "App");
    }

    #[test]
    fn affected_routes_detected() {
        let analysis = sample_analysis();
        let report = analyze_impact("StatsCard", &analysis);

        assert!(report.affected_routes.contains(&"/".to_string()));
    }
}
