use anyhow::Result;
use colored::Colorize;
use std::path::Path;

pub fn run(path: String, _framework: String, _include: Option<String>) -> Result<()> {
    println!(
        "{} 코드 분석 시작: {}",
        "▶".green().bold(),
        path.cyan()
    );

    let source_path = Path::new(&path);
    if !source_path.exists() {
        anyhow::bail!("경로가 존재하지 않습니다: {}", path);
    }

    let result = reverseng_analyzer::analyze_project(source_path)?;

    println!("{} 코드 분석 완료!", "✓".green().bold());
    println!("  프레임워크: {:?}", result.framework);
    println!("  컴포넌트: {}개", result.components.len());
    println!("  라우트: {}개", result.routes.len());
    println!("  함수: {}개", result.functions.len());

    // 결과를 JSON으로 저장
    let output_path = "output/analysis.json";
    std::fs::create_dir_all("output")?;
    let json = serde_json::to_string_pretty(&result)?;
    std::fs::write(output_path, json)?;
    println!("  결과 저장: {}", output_path.cyan());

    Ok(())
}
