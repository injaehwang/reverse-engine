use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// 취약점 검사 결과
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    pub vulnerabilities: Vec<Vulnerability>,
    pub summary: AuditSummary,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vulnerability {
    pub package_name: String,
    pub severity: String, // critical, high, moderate, low
    pub title: String,
    pub url: String,
    pub vulnerable_versions: String,
    pub patched_versions: String,
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSummary {
    pub total: usize,
    pub critical: usize,
    pub high: usize,
    pub moderate: usize,
    pub low: usize,
}

/// npm audit 실행 및 결과 파싱
pub fn run_npm_audit(project_path: &Path) -> Result<AuditReport> {
    let package_json = project_path.join("package.json");
    if !package_json.exists() {
        return Ok(AuditReport {
            vulnerabilities: vec![],
            summary: AuditSummary { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
            warnings: vec!["package.json이 존재하지 않아 취약점 검사를 건너뜁니다.".into()],
        });
    }

    // npm audit --json 실행
    let output = Command::new("npm")
        .args(["audit", "--json", "--omit=dev"])
        .current_dir(project_path)
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            tracing::warn!("npm audit 실행 실패: {}. npm이 설치되어 있는지 확인하세요.", e);
            return Ok(AuditReport {
                vulnerabilities: vec![],
                summary: AuditSummary { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
                warnings: vec![format!("npm audit 실행 실패: {}. 취약점 검사 결과가 없습니다.", e)],
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // npm audit은 취약점이 있으면 exit code 1을 반환하므로 status 무시
    parse_npm_audit_json(&stdout)
}

/// npm audit JSON 출력 파싱
fn parse_npm_audit_json(json_str: &str) -> Result<AuditReport> {
    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => {
            return Ok(AuditReport {
                vulnerabilities: vec![],
                summary: AuditSummary { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
                warnings: vec!["npm audit 출력을 파싱할 수 없습니다.".into()],
            });
        }
    };

    let mut vulnerabilities = Vec::new();

    // npm audit v2 형식: { vulnerabilities: { "package-name": { ... } } }
    if let Some(vulns) = parsed.get("vulnerabilities").and_then(|v| v.as_object()) {
        for (pkg_name, vuln_data) in vulns {
            let severity = vuln_data.get("severity")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown")
                .to_string();

            let via = vuln_data.get("via")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            // fixAvailable 정보 추출
        let fix_available = vuln_data.get("fixAvailable")
            .and_then(|f| {
                if f.is_boolean() {
                    if f.as_bool().unwrap_or(false) { Some("fix available".to_string()) } else { None }
                } else {
                    f.get("version").and_then(|v| v.as_str()).map(|v| v.to_string())
                }
            })
            .unwrap_or_default();

        for v in &via {
                if let Some(obj) = v.as_object() {
                    vulnerabilities.push(Vulnerability {
                        package_name: pkg_name.clone(),
                        severity: obj.get("severity")
                            .and_then(|s| s.as_str())
                            .unwrap_or(&severity)
                            .to_string(),
                        title: obj.get("title")
                            .and_then(|s| s.as_str())
                            .unwrap_or("Unknown vulnerability")
                            .to_string(),
                        url: obj.get("url")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string(),
                        vulnerable_versions: obj.get("range")
                            .and_then(|s| s.as_str())
                            .unwrap_or("*")
                            .to_string(),
                        patched_versions: fix_available.clone(),
                        path: vec![pkg_name.clone()],
                    });
                }
            }
        }
    }

    let mut summary = AuditSummary { total: 0, critical: 0, high: 0, moderate: 0, low: 0 };

    // 요약 정보
    if let Some(metadata) = parsed.get("metadata").and_then(|m| m.get("vulnerabilities")) {
        summary.critical = metadata.get("critical").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        summary.high = metadata.get("high").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        summary.moderate = metadata.get("moderate").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        summary.low = metadata.get("low").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        summary.total = summary.critical + summary.high + summary.moderate + summary.low;
    } else {
        summary.total = vulnerabilities.len();
        for v in &vulnerabilities {
            match v.severity.as_str() {
                "critical" => summary.critical += 1,
                "high" => summary.high += 1,
                "moderate" => summary.moderate += 1,
                _ => summary.low += 1,
            }
        }
    }

    Ok(AuditReport {
        vulnerabilities,
        summary,
        warnings: vec![],
    })
}
