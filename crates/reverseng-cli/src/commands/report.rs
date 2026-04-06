use anyhow::Result;
use colored::Colorize;
use std::process::Stdio;

pub async fn run(input: String, format: String) -> Result<()> {
    println!(
        "{} 리포트 생성 시작",
        "▶".green().bold()
    );
    println!("  입력: {}", input.cyan());
    println!("  형식: {}", format.cyan());

    // 실행 파일 기준으로 node/ 디렉토리 찾기
    let exe_dir = std::env::current_exe()?
        .parent()
        .unwrap()
        .to_path_buf();

    // 프로젝트 루트 기준 경로 탐색 (dev/release 모두 지원)
    let script_candidates = [
        std::env::current_dir()?.join("node/docgen/dist/cli-entry.js"),
        exe_dir.join("../../node/docgen/dist/cli-entry.js"),
        exe_dir.join("../../../node/docgen/dist/cli-entry.js"),
    ];

    let script_path = script_candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| anyhow::anyhow!(
            "node/docgen/dist/cli-entry.js를 찾을 수 없습니다.\n  pnpm -C node/docgen build 를 먼저 실행하세요."
        ))?;

    // 출력 디렉토리 결정
    let output_dir = std::path::Path::new(&input)
        .parent()
        .unwrap_or(std::path::Path::new("output"))
        .join("reports");

    let output = tokio::process::Command::new("node")
        .arg(script_path)
        .arg(&input)
        .arg(output_dir.to_string_lossy().to_string())
        .arg(&format)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?
        .wait_with_output()
        .await?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout.trim()) {
            if let Some(outputs) = resp.get("data").and_then(|d| d.get("outputs")).and_then(|o| o.as_array()) {
                println!("{} 리포트 생성 완료!", "✓".green().bold());
                for path in outputs {
                    println!("  → {}", path.as_str().unwrap_or("").cyan());
                }
            }
        } else {
            println!("{} 리포트 생성 완료!", "✓".green().bold());
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        println!(
            "{} 리포트 생성 실패: {}",
            "✗".red().bold(),
            stderr
        );
    }

    Ok(())
}
