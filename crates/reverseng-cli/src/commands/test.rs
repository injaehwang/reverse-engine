use anyhow::Result;
use colored::Colorize;
use std::process::Stdio;

pub async fn run(input: String, test_type: String, output: String) -> Result<()> {
    println!(
        "{} 테스트 코드 생성 시작",
        "▶".green().bold()
    );
    println!("  입력: {}", input.cyan());
    println!("  종류: {}", test_type.cyan());
    println!("  출력: {}", output.cyan());

    let script_candidates = [
        std::env::current_dir()?.join("node/testgen/dist/cli-entry.js"),
        std::env::current_exe()?
            .parent()
            .unwrap()
            .join("../../node/testgen/dist/cli-entry.js"),
        std::env::current_exe()?
            .parent()
            .unwrap()
            .join("../../../node/testgen/dist/cli-entry.js"),
    ];

    let script_path = script_candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| anyhow::anyhow!(
            "node/testgen/dist/cli-entry.js를 찾을 수 없습니다.\n  pnpm -C node/testgen build 를 먼저 실행하세요."
        ))?;

    let cmd_output = tokio::process::Command::new("node")
        .arg(script_path)
        .arg(&input)
        .arg(&output)
        .arg(&test_type)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?
        .wait_with_output()
        .await?;

    if cmd_output.status.success() {
        let stdout = String::from_utf8_lossy(&cmd_output.stdout);
        if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout.trim()) {
            if let Some(files) = resp.get("data").and_then(|d| d.get("files")).and_then(|f| f.as_array()) {
                println!("{} 테스트 코드 생성 완료! ({}개 파일)", "✓".green().bold(), files.len());
                for path in files {
                    println!("  → {}", path.as_str().unwrap_or("").cyan());
                }
            }
        } else {
            println!("{} 테스트 코드 생성 완료!", "✓".green().bold());
        }
    } else {
        let stderr = String::from_utf8_lossy(&cmd_output.stderr);
        println!(
            "{} 테스트 생성 실패: {}",
            "✗".red().bold(),
            stderr
        );
    }

    Ok(())
}
