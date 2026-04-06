use anyhow::Result;
use tree_sitter::{Parser, Tree};

/// Vue SFC 파싱 — <script> 블록을 추출하여 TS/JS로 파싱
pub fn parse(source: &str) -> Result<Tree> {
    // Vue SFC에서 <script> 또는 <script setup> 블록 추출
    let script_content = extract_script_block(source);

    let mut parser = Parser::new();
    // Vue의 script는 대부분 TypeScript
    let language = tree_sitter_typescript::LANGUAGE_TSX.into();
    parser.set_language(&language)?;

    parser
        .parse(&script_content, None)
        .ok_or_else(|| anyhow::anyhow!("Vue script 파싱 실패"))
}

fn extract_script_block(source: &str) -> String {
    // <script ...> 과 </script> 사이의 내용 추출
    let mut in_script = false;
    let mut content = String::new();

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("<script") {
            in_script = true;
            // <script> 태그 자체의 줄은 건너뛰기 (단, 한 줄에 내용이 있을 수 있음)
            if let Some(pos) = trimmed.find('>') {
                let after_tag = &trimmed[pos + 1..];
                if !after_tag.is_empty() {
                    content.push_str(after_tag);
                    content.push('\n');
                }
            }
            continue;
        }
        if trimmed.starts_with("</script") {
            in_script = false;
            continue;
        }
        if in_script {
            content.push_str(line);
            content.push('\n');
        }
    }

    if content.is_empty() {
        // script 블록이 없으면 전체를 반환 (fallback)
        source.to_string()
    } else {
        content
    }
}
