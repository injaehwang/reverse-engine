pub mod extractors;
pub mod framework;
pub mod parsers;

use anyhow::Result;
use rayon::prelude::*;
use reverseng_core::types::analyzer::{
    AnalysisResult, ApiClientCall, ComponentInfo, FunctionInfo, RouteInfo,
};
use std::path::Path;
use walkdir::WalkDir;

/// 소스코드 분석 메인 엔트리포인트
pub fn analyze_project(source_path: &Path) -> Result<AnalysisResult> {
    let framework = framework::detect_framework(source_path)?;
    tracing::info!("감지된 프레임워크: {:?}", framework);

    // 1. 분석 대상 파일 수집
    let source_files = collect_source_files(source_path);
    tracing::info!("분석 대상 파일: {}개", source_files.len());

    // 2. 각 파일을 병렬로 파싱 및 추출
    let file_results: Vec<FileAnalysis> = source_files
        .par_iter()
        .filter_map(|file_path| {
            match analyze_single_file(file_path, source_path) {
                Ok(result) => Some(result),
                Err(e) => {
                    tracing::warn!("파일 분석 실패: {} - {}", file_path.display(), e);
                    None
                }
            }
        })
        .collect();

    // 3. 결과 통합
    let mut components = Vec::new();
    let mut functions = Vec::new();
    let mut api_clients = Vec::new();
    let mut routes = Vec::new();

    for result in &file_results {
        components.extend(result.components.clone());
        functions.extend(result.functions.clone());
        api_clients.extend(result.api_clients.clone());
        routes.extend(result.routes.clone());
    }

    // 4. 호출 관계 역참조 구축 (called_by, used_by)
    build_reverse_references(&mut functions, &mut components);

    // 5. 의존성 분석
    let dependencies = extractors::dependency::extract_dependencies(source_path)?;

    tracing::info!(
        "분석 완료: 컴포넌트 {}개, 함수 {}개, API {}개, 라우트 {}개, 의존성 {}개",
        components.len(),
        functions.len(),
        api_clients.len(),
        routes.len(),
        dependencies.len(),
    );

    Ok(AnalysisResult {
        source_path: source_path.to_string_lossy().into(),
        framework,
        components,
        routes,
        functions,
        api_clients,
        state_stores: vec![], // TODO
        dependencies,
    })
}

/// 개별 파일 분석 결과
struct FileAnalysis {
    components: Vec<ComponentInfo>,
    functions: Vec<FunctionInfo>,
    api_clients: Vec<ApiClientCall>,
    routes: Vec<RouteInfo>,
}

/// 단일 파일 분석
fn analyze_single_file(file_path: &Path, project_root: &Path) -> Result<FileAnalysis> {
    let source = std::fs::read_to_string(file_path)?;
    let relative_path = file_path
        .strip_prefix(project_root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string();

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let tree = match ext {
        "ts" | "tsx" => parsers::typescript::parse(&source)?,
        "js" | "jsx" | "mjs" => parsers::javascript::parse(&source)?,
        "vue" => parsers::vue::parse(&source)?,
        "py" => parsers::python::parse(&source)?,
        _ => return Ok(FileAnalysis {
            components: vec![],
            functions: vec![],
            api_clients: vec![],
            routes: vec![],
        }),
    };

    let components = extractors::component::extract(&tree, &source, &relative_path, ext)?;
    let functions = extractors::function::extract(&tree, &source, &relative_path)?;
    let api_clients = extractors::api_call::extract(&tree, &source, &relative_path)?;
    let routes = extractors::route::extract(&tree, &source, &relative_path)?;

    Ok(FileAnalysis {
        components,
        functions,
        api_clients,
        routes,
    })
}

/// 분석 대상 소스파일 수집
fn collect_source_files(source_path: &Path) -> Vec<std::path::PathBuf> {
    let extensions = ["ts", "tsx", "js", "jsx", "mjs", "vue", "py"];
    let ignore_dirs = ["node_modules", "dist", "build", ".next", "__pycache__", ".git", "target"];

    WalkDir::new(source_path)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !ignore_dirs.iter().any(|d| name == *d)
        })
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| extensions.contains(&ext))
        })
        .map(|e| e.into_path())
        .collect()
}

/// called_by / used_by 역참조 구축
fn build_reverse_references(functions: &mut [FunctionInfo], components: &mut [ComponentInfo]) {
    // 함수의 called_by 구축
    let call_pairs: Vec<(String, String)> = functions
        .iter()
        .flat_map(|f| {
            f.calls
                .iter()
                .map(move |callee| (callee.clone(), f.name.clone()))
        })
        .collect();

    for (callee, caller) in &call_pairs {
        if let Some(func) = functions.iter_mut().find(|f| &f.name == callee) {
            if !func.called_by.contains(caller) {
                func.called_by.push(caller.clone());
            }
        }
    }

    // 컴포넌트의 used_by 구축
    let child_pairs: Vec<(String, String)> = components
        .iter()
        .flat_map(|c| {
            c.children
                .iter()
                .map(move |child| (child.clone(), c.name.clone()))
        })
        .collect();

    for (child, parent) in &child_pairs {
        if let Some(comp) = components.iter_mut().find(|c| &c.name == child) {
            if !comp.used_by.contains(parent) {
                comp.used_by.push(parent.clone());
            }
        }
    }
}
