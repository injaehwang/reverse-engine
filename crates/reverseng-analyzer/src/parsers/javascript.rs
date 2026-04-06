use anyhow::Result;
use tree_sitter::{Parser, Tree};

/// JavaScript/JSX 소스코드 파싱
pub fn parse(source: &str) -> Result<Tree> {
    let mut parser = Parser::new();
    let language = tree_sitter_javascript::LANGUAGE.into();
    parser.set_language(&language)?;

    parser
        .parse(source, None)
        .ok_or_else(|| anyhow::anyhow!("JavaScript 파싱 실패"))
}
