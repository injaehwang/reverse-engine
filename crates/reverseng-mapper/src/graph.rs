use anyhow::Result;
use reverseng_core::types::analyzer::AnalysisResult;
use reverseng_core::types::crawler::CrawlResult;
use reverseng_core::types::mapper::{EdgeType, GraphEdge, GraphNode, NodeType, RelationGraph};

use crate::cross_ref;

pub struct GraphBuilder {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    crawl_data: Option<CrawlResult>,
    analysis_data: Option<AnalysisResult>,
}

impl GraphBuilder {
    pub fn new() -> Self {
        Self {
            nodes: vec![],
            edges: vec![],
            crawl_data: None,
            analysis_data: None,
        }
    }

    /// 크롤링 데이터에서 페이지/API 노드와 네비게이션 엣지 추가
    pub fn add_crawl_data(&mut self, crawl: &CrawlResult) -> Result<()> {
        self.crawl_data = Some(crawl.clone());
        for page in &crawl.pages {
            let node_id = format!("page:{}", page.url);
            self.nodes.push(GraphNode {
                id: node_id.clone(),
                node_type: NodeType::Page,
                label: page.title.clone(),
                file_path: None,
                url: Some(page.url.clone()),
                metadata: serde_json::json!({
                    "auth_required": page.auth_required,
                    "screenshot": page.screenshot_path,
                }),
            });

            // 페이지 간 네비게이션 엣지
            for target_url in &page.navigates_to {
                self.edges.push(GraphEdge {
                    from_id: node_id.clone(),
                    to_id: format!("page:{}", target_url),
                    edge_type: EdgeType::NavigatesTo,
                    label: None,
                    metadata: None,
                });
            }

            // API 호출 엣지
            for api_call in &page.api_calls {
                let api_id = format!("api:{}:{}", api_call.method, api_call.url);
                self.nodes.push(GraphNode {
                    id: api_id.clone(),
                    node_type: NodeType::ApiEndpoint,
                    label: format!("{} {}", api_call.method, api_call.url),
                    file_path: None,
                    url: Some(api_call.url.clone()),
                    metadata: serde_json::json!({
                        "method": api_call.method,
                        "status": api_call.response_status,
                    }),
                });

                self.edges.push(GraphEdge {
                    from_id: node_id.clone(),
                    to_id: api_id,
                    edge_type: EdgeType::Calls,
                    label: api_call.triggered_by.clone(),
                    metadata: None,
                });
            }
        }
        Ok(())
    }

    /// 코드 분석 데이터에서 컴포넌트/함수 노드와 관계 엣지 추가
    pub fn add_analysis_data(&mut self, analysis: &AnalysisResult) -> Result<()> {
        self.analysis_data = Some(analysis.clone());
        // 컴포넌트 노드
        for comp in &analysis.components {
            let node_id = format!("comp:{}", comp.name);
            self.nodes.push(GraphNode {
                id: node_id.clone(),
                node_type: NodeType::Component,
                label: comp.name.clone(),
                file_path: Some(comp.file_path.clone()),
                url: None,
                metadata: serde_json::json!({
                    "props": comp.props,
                    "hooks": comp.hooks,
                }),
            });

            // 하위 컴포넌트 관계
            for child in &comp.children {
                self.edges.push(GraphEdge {
                    from_id: node_id.clone(),
                    to_id: format!("comp:{}", child),
                    edge_type: EdgeType::Imports,
                    label: None,
                    metadata: None,
                });
            }
        }

        // 라우트 → 컴포넌트 매핑
        for route in &analysis.routes {
            self.edges.push(GraphEdge {
                from_id: format!("page:{}", route.path),
                to_id: format!("comp:{}", route.component),
                edge_type: EdgeType::RenderedBy,
                label: None,
                metadata: None,
            });
        }

        // 함수 노드 및 호출 관계
        for func in &analysis.functions {
            let node_id = format!("func:{}", func.name);
            self.nodes.push(GraphNode {
                id: node_id.clone(),
                node_type: NodeType::Function,
                label: func.name.clone(),
                file_path: Some(func.file_path.clone()),
                url: None,
                metadata: serde_json::json!({
                    "is_async": func.is_async,
                    "is_exported": func.is_exported,
                    "params": func.params,
                }),
            });

            for callee in &func.calls {
                self.edges.push(GraphEdge {
                    from_id: node_id.clone(),
                    to_id: format!("func:{}", callee),
                    edge_type: EdgeType::Calls,
                    label: None,
                    metadata: None,
                });
            }
        }

        Ok(())
    }

    /// 크롤링 결과와 코드 분석 결과 교차 검증
    pub fn cross_reference(&mut self) -> Result<()> {
        let (Some(crawl), Some(analysis)) = (&self.crawl_data, &self.analysis_data) else {
            return Ok(());
        };

        let report = cross_ref::cross_reference(crawl, analysis);

        // 매칭된 API: 코드 노드 ↔ 크롤링 노드 연결
        for matched in &report.matched_apis {
            let code_id = format!("func:{}", matched.code_function);
            for obs_url in &matched.observed_urls {
                let page_id = format!("page:{}", obs_url);
                self.edges.push(GraphEdge {
                    from_id: page_id,
                    to_id: code_id.clone(),
                    edge_type: EdgeType::Calls,
                    label: Some(format!("{} {}", matched.method, matched.url_pattern)),
                    metadata: None,
                });
            }
        }

        Ok(())
    }

    /// 교차 검증 보고서 반환
    pub fn get_cross_ref_report(&self) -> Option<cross_ref::CrossRefReport> {
        let (crawl, analysis) = (self.crawl_data.as_ref()?, self.analysis_data.as_ref()?);
        Some(cross_ref::cross_reference(crawl, analysis))
    }

    pub fn build(self) -> RelationGraph {
        RelationGraph {
            nodes: self.nodes,
            edges: self.edges,
        }
    }
}
