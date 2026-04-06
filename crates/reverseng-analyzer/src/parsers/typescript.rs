use anyhow::Result;
use tree_sitter::{Parser, Tree};

/// TypeScript/TSX 소스코드 파싱
pub fn parse(source: &str) -> Result<Tree> {
    let mut parser = Parser::new();
    let language = tree_sitter_typescript::LANGUAGE_TSX.into();
    parser.set_language(&language)?;

    parser
        .parse(source, None)
        .ok_or_else(|| anyhow::anyhow!("TypeScript 파싱 실패"))
}
