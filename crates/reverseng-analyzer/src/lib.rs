pub mod cache;
pub mod extractors;
pub mod framework;
pub mod parsers;

use anyhow::Result;
use cache::AnalysisCache;
use rayon::prelude::*;
use reverseng_core::types::analyzer::{
    AnalysisResult, ApiClientCall, ComponentInfo, FunctionInfo, RouteInfo, StateStoreInfo,
};
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

/// 소스코드 분석 메인 엔트리포인트
pub fn analyze_project(source_path: &Path) -> Result<AnalysisResult> {
    let framework = framework::detect_framework(source_path)?;
    tracing::info!("감지된 프레임워크: {:?}", framework);

    // 1. 분석 대상 파일 수집 + 해시 계산
    let source_files = collect_source_files(source_path);
    tracing::info!("분석 대상 파일: {}개", source_files.len());

    let file_hashes: Vec<(std::path::PathBuf, String)> = source_files
        .par_iter()
        .filter_map(|path| {
            cache::hash_file(path)
                .ok()
                .map(|hash| (path.clone(), hash))
        })
        .collect();

    // 2. 캐시 확인 → 증분 분석
    let cached = AnalysisCache::load(source_path);
    // 경로를 forward slash로 정규화 (Windows/Unix 통일)
    let hash_map: HashMap<String, String> = file_hashes
        .iter()
        .map(|(p, h)| (p.to_string_lossy().replace('\\', "/"), h.clone()))
        .collect();

    let (files_to_analyze, cached_results) = if let Some(ref cache) = cached {
        let diff = cache::compute_diff(&file_hashes, &cache.file_hashes);
        tracing::info!(
            "증분 분석: 변경 {}개, 삭제 {}개, 변경없음 {}개",
            diff.changed.len(),
            diff.deleted.len(),
            diff.unchanged_count
        );

        if diff.changed.is_empty() && diff.deleted.is_empty() {
            tracing::info!("변경 없음, 캐시된 결과 반환");
            return Ok(cache.result.clone());
        }

        // 캐시에서 삭제/변경된 파일의 결과를 제거
        let mut cached_result = cache.result.clone();

        let mut remove_set: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 변경된 파일의 상대 경로 (forward slash 정규화)
        for p in &diff.changed {
            if let Ok(rel) = p.strip_prefix(source_path) {
                remove_set.insert(rel.to_string_lossy().replace('\\', "/"));
            }
        }

        // 삭제된 파일의 상대 경로
        for p in &diff.deleted {
            if let Ok(rel) = Path::new(p).strip_prefix(source_path) {
                remove_set.insert(rel.to_string_lossy().replace('\\', "/"));
            } else {
                remove_set.insert(p.replace('\\', "/"));
            }
        }

        // file_path도 정규화해서 비교
        cached_result.components.retain(|c| !remove_set.contains(&c.file_path.replace('\\', "/")));
        cached_result.functions.retain(|f| !remove_set.contains(&f.file_path.replace('\\', "/")));
        cached_result.api_clients.retain(|a| !remove_set.contains(&a.file_path.replace('\\', "/")));
        cached_result.routes.retain(|r| !remove_set.contains(&r.file_path.replace('\\', "/")));
        cached_result.state_stores.retain(|s| !remove_set.contains(&s.file_path.replace('\\', "/")));

        (diff.changed, Some(cached_result))
    } else {
        (source_files, None)
    };

    // 3. 변경된 파일만 병렬 분석
    let file_results: Vec<FileAnalysis> = files_to_analyze
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

    // 4. 결과 통합 (캐시 + 새 분석)
    let mut components = Vec::new();
    let mut functions = Vec::new();
    let mut api_clients = Vec::new();
    let mut routes = Vec::new();
    let mut state_stores = Vec::new();

    if let Some(cached) = cached_results {
        components.extend(cached.components);
        functions.extend(cached.functions);
        api_clients.extend(cached.api_clients);
        routes.extend(cached.routes);
        state_stores.extend(cached.state_stores);
    }

    for result in &file_results {
        components.extend(result.components.clone());
        functions.extend(result.functions.clone());
        api_clients.extend(result.api_clients.clone());
        routes.extend(result.routes.clone());
        state_stores.extend(result.state_stores.clone());
    }

    // 5. 호출 관계 역참조 전체 재구축 (캐시+신규 통합 후)
    // called_by/used_by를 초기화 후 다시 계산
    for f in &mut functions {
        f.called_by.clear();
    }
    for c in &mut components {
        c.used_by.clear();
    }
    build_reverse_references(&mut functions, &mut components);

    // 6. 의존성 분석
    let dependencies = extractors::dependency::extract_dependencies(source_path)?;

    tracing::info!(
        "분석 완료: 컴포넌트 {}개, 함수 {}개, API {}개, 라우트 {}개, 의존성 {}개",
        components.len(),
        functions.len(),
        api_clients.len(),
        routes.len(),
        dependencies.len(),
    );

    let result = AnalysisResult {
        source_path: source_path.to_string_lossy().into(),
        framework,
        components,
        routes,
        functions,
        api_clients,
        state_stores,
        dependencies,
    };

    // 7. 캐시 저장
    let new_cache = AnalysisCache::new(hash_map, result.clone());
    if let Err(e) = new_cache.save(source_path) {
        tracing::warn!("캐시 저장 실패: {}", e);
    }

    Ok(result)
}

/// 개별 파일 분석 결과
struct FileAnalysis {
    components: Vec<ComponentInfo>,
    functions: Vec<FunctionInfo>,
    api_clients: Vec<ApiClientCall>,
    routes: Vec<RouteInfo>,
    state_stores: Vec<StateStoreInfo>,
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
            state_stores: vec![],
        }),
    };

    let components = extractors::component::extract(&tree, &source, &relative_path, ext)?;
    let functions = extractors::function::extract(&tree, &source, &relative_path)?;
    let api_clients = extractors::api_call::extract(&tree, &source, &relative_path)?;
    let routes = extractors::route::extract(&tree, &source, &relative_path)?;
    let state_stores = extractors::state::extract(&tree, &source, &relative_path)?;

    Ok(FileAnalysis {
        components,
        functions,
        api_clients,
        routes,
        state_stores,
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
