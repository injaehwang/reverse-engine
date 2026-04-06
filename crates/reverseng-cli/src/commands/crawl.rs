use anyhow::Result;
use colored::Colorize;
use reverseng_core::ipc::{call_node_script, IpcRequest};

pub async fn run(
    url: String,
    max_depth: u32,
    max_pages: u32,
    screenshot: bool,
    har: bool,
    auth_cookie: Option<String>,
) -> Result<()> {
    println!(
        "{} 크롤링 시작: {}",
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

    // Node.js 크롤러 프로세스 호출
    let response = call_node_script("node/crawler/dist/index.js", &request).await?;

    if response.success {
        println!("{} 크롤링 완료!", "✓".green().bold());
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
            "{} 크롤링 실패: {}",
            "✗".red().bold(),
            response.error.unwrap_or_default()
        );
    }

    Ok(())
}
