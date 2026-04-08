use anyhow::Result;
use colored::Colorize;
use std::path::Path;

pub fn run(path: Option<String>, impact_target: Option<String>) -> Result<()> {
    let path_str = path.unwrap_or_else(|| ".".into());
    let project_path = Path::new(&path_str);

    println!(
        "{} 업그레이드 분석 시작: {}",
        "▶".green().bold(),
        path_str.cyan()
    );

    // 분석 결과가 있으면 로드
    let analysis_path = project_path.join("output/analysis.json");
    let analysis = if analysis_path.exists() {
        let content = std::fs::read_to_string(&analysis_path)?;
        Some(serde_json::from_str(&content)?)
    } else {
        // .reverse-engine/analysis.json도 확인
        let alt_path = project_path.join(".reverse-engine/analysis.json");
        if alt_path.exists() {
            let content = std::fs::read_to_string(&alt_path)?;
            Some(serde_json::from_str(&content)?)
        } else {
            println!(
                "  {} 분석 결과 없음 — dead code 탐지를 건너뜁니다",
                "⚠".yellow()
            );
            None
        }
    };

    let report = reverseng_upgrader::analyze_upgrade(
        project_path,
        analysis.as_ref(),
        impact_target.as_deref(),
    )?;

    // 취약점 보고
    println!("\n{}", "━".repeat(50));
    println!("{} 의존성 취약점 검사", "🔍".bold());
    let audit = &report.audit;
    if audit.summary.total == 0 {
        println!("  {} 취약점 없음", "✓".green().bold());
    } else {
        println!(
            "  {} 취약점 {}개 발견",
            "⚠".yellow().bold(),
            audit.summary.total
        );
        if audit.summary.critical > 0 {
            println!("    {} Critical: {}", "●".red(), audit.summary.critical);
        }
        if audit.summary.high > 0 {
            println!("    {} High: {}", "●".red(), audit.summary.high);
        }
        if audit.summary.moderate > 0 {
            println!("    {} Moderate: {}", "●".yellow(), audit.summary.moderate);
        }
        if audit.summary.low > 0 {
            println!("    {} Low: {}", "●".white(), audit.summary.low);
        }

        for vuln in &audit.vulnerabilities {
            println!(
                "    {} [{}] {} ({})",
                "→".dimmed(),
                vuln.severity.to_uppercase(),
                vuln.title,
                vuln.package_name
            );
        }
    }

    // Dead code 보고
    if analysis.is_some() {
        println!("\n{}", "━".repeat(50));
        println!("{} Dead Code 탐지", "🔍".bold());
        let dc = &report.dead_code;
        if dc.summary.total == 0 {
            println!("  {} 미사용 코드 없음", "✓".green().bold());
        } else {
            println!(
                "  {} 미사용 항목 {}개 발견",
                "⚠".yellow().bold(),
                dc.summary.total
            );

            for item in &dc.unused_components {
                println!(
                    "    {} 컴포넌트 {} ({})",
                    "→".dimmed(),
                    item.name.yellow(),
                    item.file_path
                );
            }
            for item in &dc.unused_functions {
                println!(
                    "    {} 함수 {} ({})",
                    "→".dimmed(),
                    item.name.yellow(),
                    item.file_path
                );
            }
            for route in &dc.unreachable_routes {
                println!(
                    "    {} 라우트 {} → {} (컴포넌트 미존재)",
                    "→".dimmed(),
                    route.path.yellow(),
                    route.component
                );
            }
        }
    }

    // 영향도 분석 보고
    if let Some(ref impact) = report.impact {
        println!("\n{}", "━".repeat(50));
        println!("{} 변경 영향도 분석: {}", "🔍".bold(), impact.target.cyan());
        if impact.direct_impacts.is_empty() && impact.transitive_impacts.is_empty() {
            println!("  {} 영향받는 항목 없음", "✓".green().bold());
        } else {
            if !impact.direct_impacts.is_empty() {
                println!("  직접 영향 ({}개):", impact.direct_impacts.len());
                for item in &impact.direct_impacts {
                    println!("    {} {} ({}) — {}", "→".dimmed(), item.name.yellow(), item.file_path, item.relation);
                }
            }
            if !impact.transitive_impacts.is_empty() {
                println!("  간접 영향 ({}개):", impact.transitive_impacts.len());
                for item in &impact.transitive_impacts {
                    println!("    {} {} ({}) — depth {}", "→".dimmed(), item.name.yellow(), item.file_path, item.depth);
                }
            }
            if !impact.affected_routes.is_empty() {
                println!("  영향받는 라우트: {}", impact.affected_routes.join(", ").cyan());
            }
            if !impact.affected_apis.is_empty() {
                println!("  영향받는 API: {}", impact.affected_apis.join(", ").cyan());
            }
        }
    }

    // 결과 저장
    let output_path = if project_path.join("output").exists() {
        project_path.join("output/upgrade-report.json")
    } else {
        project_path.join(".reverse-engine/upgrade-report.json")
    };

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&output_path, serde_json::to_string_pretty(&report)?)?;

    println!("\n{} 업그레이드 분석 완료!", "✓".green().bold());
    println!("  결과 저장: {}", output_path.display().to_string().cyan());

    Ok(())
}
