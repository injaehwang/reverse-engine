use anyhow::Result;
use colored::Colorize;
use reverseng_core::ipc::{call_node_script_file_ipc, IpcRequest};

pub async fn run(
    url: String,
    max_depth: u32,
    max_pages: u32,
    screenshot: bool,
    har: bool,
    auth_cookie: Option<String>,
) -> Result<()> {
    println!(
        "\n{} 이 도구는 개발/테스트 환경 전용입니다.",
        "⚠".yellow().bold()
    );
    println!(
        "  크롤러가 버튼 클릭, 폼 제출을 자동 수행하므로 실제 데이터가 변경될 수 있습니다.\n"
    );
    println!(
        "{} 분석 중: {}",
        "▶".green().bold(),
        url.cyan()
    );
    println!("  최대 깊이: {}, 최대 페이지: {}", max_depth, max_pages);

    let request = IpcRequest {
        command: "crawl".into(),
        payload: serde_json::json!({
            "url": url,
            "maxDepth": max_depth,
            "maxPages": max_pages,
            "screenshot": screenshot,
            "har": har,
            "authCookie": auth_cookie,
        }),
    };

    // Node.js 크롤러 프로세스 호출 (파일 기반 IPC — 대용량 결과 대응)
    let response = call_node_script_file_ipc("node/crawler/dist/index.js", &request).await?;

    if response.success {
        println!("{} 분석 완료!", "✓".green().bold());
        if let Some(data) = &response.data {
            let pages_count = data
                .get("pages")
                .and_then(|p| p.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            println!("  발견된 페이지: {}", pages_count);
        }
    } else {
        println!(
            "{} 분석 실패: {}",
            "✗".red().bold(),
            response.error.unwrap_or_default()
        );
    }

    Ok(())
}
