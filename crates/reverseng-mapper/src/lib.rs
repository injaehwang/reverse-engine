pub mod cross_ref;
pub mod db;
pub mod graph;

use anyhow::Result;
use reverseng_core::types::analyzer::AnalysisResult;
use reverseng_core::types::crawler::CrawlResult;
use reverseng_core::types::mapper::RelationGraph;

/// 크롤링 결과와 코드 분석 결과를 통합하여 관계 그래프 구축
pub fn build_relation_graph(
    crawl: Option<&CrawlResult>,
    analysis: Option<&AnalysisResult>,
) -> Result<RelationGraph> {
    let mut builder = graph::GraphBuilder::new();

    if let Some(crawl) = crawl {
        builder.add_crawl_data(crawl)?;
    }

    if let Some(analysis) = analysis {
        builder.add_analysis_data(analysis)?;
    }

    if crawl.is_some() && analysis.is_some() {
        builder.cross_reference()?;
    }

    Ok(builder.build())
}
