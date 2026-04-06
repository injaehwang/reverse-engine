use serde::{Deserialize, Serialize};

/// 프로젝트 설정 (reverseng.config.toml)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReversEngConfig {
    pub target: TargetConfig,
    pub crawler: Option<CrawlerConfig>,
    pub analyzer: Option<AnalyzerConfig>,
    pub output: OutputConfig,
    pub testgen: Option<TestGenConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetConfig {
    pub url: Option<String>,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlerConfig {
    pub max_depth: Option<u32>,
    pub max_pages: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub wait_after_click_ms: Option<u64>,
    pub viewport_width: Option<u32>,
    pub viewport_height: Option<u32>,
    pub ignore_patterns: Option<Vec<String>>,
    pub auth: Option<AuthConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub auth_type: String, // "form", "cookie", "bearer", "custom"
    pub login_url: Option<String>,
    pub credentials: Option<serde_json::Value>,
    pub submit_selector: Option<String>,
    pub cookie: Option<String>,
    pub bearer_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzerConfig {
    pub framework: Option<String>, // "auto", "react", "vue", "angular", etc.
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub router_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputConfig {
    pub dir: String,
    pub formats: Vec<String>, // "excel", "html", "markdown"
    pub screenshots: Option<bool>,
    pub mermaid: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestGenConfig {
    pub types: Vec<String>, // "e2e", "api", "visual", "flow"
    pub output_dir: String,
    pub base_url: String,
}

impl ReversEngConfig {
    /// TOML 설정 파일 로드
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: ReversEngConfig = toml::from_str(&content)?;
        Ok(config)
    }

    /// 기본 설정
    pub fn default_config() -> Self {
        Self {
            target: TargetConfig {
                url: None,
                source_path: None,
            },
            crawler: Some(CrawlerConfig {
                max_depth: Some(5),
                max_pages: Some(100),
                timeout_ms: Some(30000),
                wait_after_click_ms: Some(1000),
                viewport_width: Some(1920),
                viewport_height: Some(1080),
                ignore_patterns: Some(vec!["/logout".into(), "/external-*".into()]),
                auth: None,
            }),
            analyzer: Some(AnalyzerConfig {
                framework: Some("auto".into()),
                include: Some(vec!["src/**/*.{ts,tsx,js,jsx,vue}".into()]),
                exclude: Some(vec![
                    "node_modules".into(),
                    "dist".into(),
                    "*.test.*".into(),
                ]),
                router_file: Some("auto".into()),
            }),
            output: OutputConfig {
                dir: "./output".into(),
                formats: vec!["excel".into(), "html".into(), "markdown".into()],
                screenshots: Some(true),
                mermaid: Some(true),
            },
            testgen: Some(TestGenConfig {
                types: vec!["e2e".into(), "api".into()],
                output_dir: "./tests/generated".into(),
                base_url: "http://localhost:3000".into(),
            }),
        }
    }
}
