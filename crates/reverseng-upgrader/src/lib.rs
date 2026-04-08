pub mod audit;
pub mod dead_code;
pub mod impact;
pub mod version_diff;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

use reverseng_core::types::analyzer::AnalysisResult;

/// 업그레이드 분석 전체 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradeReport {
    pub audit: audit::AuditReport,
    pub dead_code: dead_code::DeadCodeReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact: Option<impact::ImpactReport>,
}

/// 전체 업그레이드 분석 실행
/// target: 영향도 분석할 컴포넌트/함수 이름 (Optional)
pub fn analyze_upgrade(
    project_path: &Path,
    analysis: Option<&AnalysisResult>,
    impact_target: Option<&str>,
) -> Result<UpgradeReport> {
    // 1. 취약점 검사
    let audit_report = audit::run_npm_audit(project_path)?;

    // 2. Dead code 탐지 (분석 결과가 있는 경우만)
    let dead_code_report = if let Some(analysis) = analysis {
        dead_code::detect_dead_code(analysis)
    } else {
        dead_code::DeadCodeReport {
            unused_components: vec![],
            unused_functions: vec![],
            unreachable_routes: vec![],
            summary: dead_code::DeadCodeSummary {
                unused_components: 0,
                unused_functions: 0,
                unreachable_routes: 0,
                total: 0,
            },
        }
    };

    // 3. 영향도 분석 (대상이 지정된 경우)
    let impact_report = match (impact_target, analysis) {
        (Some(target), Some(analysis)) => Some(impact::analyze_impact(target, analysis)),
        _ => None,
    };

    Ok(UpgradeReport {
        audit: audit_report,
        dead_code: dead_code_report,
        impact: impact_report,
    })
}
