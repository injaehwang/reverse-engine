mod commands;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "reverseng",
    version,
    about = "ReversEngine - 서비스 역분석 자동화 도구",
    long_about = "웹 서비스를 메인 화면부터 역분석하여 모든 URL, 버튼, 화면, 함수, API를 자동 수집하고\n문서화, 테스트 생성, 유지보수 가이드를 출력합니다."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// 설정 파일 경로
    #[arg(short, long, default_value = "reverseng.config.toml")]
    config: String,

    /// 상세 로그 출력
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// 웹 서비스 URL을 크롤링하여 화면/API 수집
    Crawl {
        /// 대상 URL
        url: String,

        /// 최대 탐색 깊이
        #[arg(long, default_value = "5")]
        max_depth: u32,

        /// 최대 페이지 수
        #[arg(long, default_value = "100")]
        max_pages: u32,

        /// 스크린샷 캡처
        #[arg(long)]
        screenshot: bool,

        /// HAR 파일 저장
        #[arg(long)]
        har: bool,

        /// 인증 쿠키
        #[arg(long)]
        auth_cookie: Option<String>,
    },

    /// 소스코드 정적 분석
    Analyze {
        /// 소스코드 경로
        path: String,

        /// 프레임워크 지정 (auto, react, vue, angular, next, nuxt)
        #[arg(long, default_value = "auto")]
        framework: String,

        /// 포함 패턴
        #[arg(long)]
        include: Option<String>,
    },

    /// 분석 결과로 리포트 생성
    Report {
        /// 분석 결과 입력 (JSON 또는 SQLite DB)
        #[arg(long)]
        input: String,

        /// 출력 형식 (excel, html, markdown)
        #[arg(long, default_value = "excel,html")]
        format: String,
    },

    /// 테스트 코드 자동 생성
    Test {
        /// 분석 결과 입력
        #[arg(long)]
        input: String,

        /// 테스트 종류 (e2e, api, visual, flow)
        #[arg(long, default_value = "e2e,api")]
        r#type: String,

        /// 출력 디렉토리
        #[arg(long, default_value = "./tests/generated")]
        output: String,
    },

    /// 의존성 감사 및 업그레이드 가이드
    Upgrade {
        /// 프로젝트 경로
        path: Option<String>,

        /// 변경 영향도 분석 대상 (컴포넌트/함수 이름)
        #[arg(long)]
        impact: Option<String>,
    },

    /// 전체 파이프라인 실행 (crawl → analyze → report → test)
    Full {
        /// 대상 URL
        #[arg(long)]
        url: Option<String>,

        /// 소스코드 경로
        #[arg(long)]
        source: Option<String>,

        /// 출력 디렉토리
        #[arg(long, default_value = "./output")]
        output: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // 로깅 초기화
    let log_level = if cli.verbose {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };
    tracing_subscriber::fmt()
        .with_max_level(log_level)
        .init();

    match cli.command {
        Commands::Crawl {
            url,
            max_depth,
            max_pages,
            screenshot,
            har,
            auth_cookie,
        } => {
            commands::crawl::run(url, max_depth, max_pages, screenshot, har, auth_cookie).await?;
        }
        Commands::Analyze {
            path,
            framework,
            include,
        } => {
            commands::analyze::run(path, framework, include)?;
        }
        Commands::Report { input, format } => {
            commands::report::run(input, format).await?;
        }
        Commands::Test {
            input,
            r#type,
            output,
        } => {
            commands::test::run(input, r#type, output).await?;
        }
        Commands::Upgrade { path, impact } => {
            commands::upgrade::run(path, impact)?;
        }
        Commands::Full {
            url,
            source,
            output,
        } => {
            commands::full::run(url, source, output).await?;
        }
    }

    Ok(())
}
