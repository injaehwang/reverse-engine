use anyhow::Result;
use colored::Colorize;

pub async fn run(
    url: Option<String>,
    source: Option<String>,
    output: String,
) -> Result<()> {
    if url.is_none() && source.is_none() {
        anyhow::bail!("--url 또는 --source 중 하나는 필수입니다");
    }

    println!(
        "\n{} ReversEngine 전체 파이프라인 시작\n",
        "◆".green().bold()
    );

    std::fs::create_dir_all(&output)?;

    let analysis_path = format!("{}/analysis.json", output);
    let report_dir = format!("{}/reports", output);
    let test_dir = format!("{}/tests", output);

    // Step 1: 크롤링 (URL이 있는 경우)
    if let Some(ref url) = url {
        println!("{}", "━".repeat(50));
        super::crawl::run(url.clone(), 5, 100, true, false, None).await?;
        println!();
    }

    // Step 2: 코드 분석 (소스 경로가 있는 경우)
    if let Some(ref source) = source {
        println!("{}", "━".repeat(50));
        super::analyze::run(source.clone(), "auto".into(), None)?;
        println!();
    }

    // Step 3: 리포트 생성
    if std::path::Path::new(&analysis_path).exists() {
        println!("{}", "━".repeat(50));
        super::report::run(analysis_path.clone(), "excel,mermaid".into()).await?;
        println!();

        // Step 4: 테스트 생성
        println!("{}", "━".repeat(50));
        super::test::run(analysis_path, "e2e,api".into(), test_dir).await?;
        println!();
    } else {
        println!(
            "{} 분석 결과 파일이 없어 리포트/테스트 생성을 건너뜁니다",
            "⚠".yellow().bold()
        );
    }

    println!(
        "\n{} 전체 파이프라인 완료! 결과: {}\n",
        "✓".green().bold(),
        output.cyan()
    );

    Ok(())
}
