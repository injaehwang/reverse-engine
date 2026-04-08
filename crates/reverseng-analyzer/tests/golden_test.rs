use reverseng_analyzer::{analyze_project, cache::AnalysisCache};
use reverseng_core::types::analyzer::{AnalysisResult, DetectedFramework};
use std::path::Path;

/// 골든 스냅샷에서 기대값을 로드
fn load_golden() -> AnalysisResult {
    let snapshot = include_str!("snapshots/sample-react.json");
    serde_json::from_str(snapshot).expect("골든 스냅샷 파싱 실패")
}

/// 테스트 fixture 경로 (workspace 루트 기준)
fn fixture_path() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("test-fixtures/sample-react")
        .leak()
}

/// sample-react 분석 실행 (캐시 무시 — 항상 전체 분석)
fn run_analysis() -> AnalysisResult {
    // 테스트에서는 캐시를 지워서 항상 전체 분석 실행
    let cache_file = fixture_path().join(".reverse-engine/analysis-cache.json");
    let _ = std::fs::remove_file(&cache_file);
    analyze_project(fixture_path()).expect("분석 실행 실패")
}

// ============================================================
// 프레임워크 감지
// ============================================================

#[test]
fn detects_react_framework() {
    let result = run_analysis();
    assert!(
        matches!(result.framework, DetectedFramework::React),
        "React 프레임워크를 감지해야 함, 실제: {:?}",
        result.framework
    );
}

// ============================================================
// 컴포넌트 감지
// ============================================================

#[test]
fn finds_all_components() {
    let golden = load_golden();
    let result = run_analysis();

    let mut golden_names: Vec<&str> = golden.components.iter().map(|c| c.name.as_str()).collect();
    let mut result_names: Vec<&str> = result.components.iter().map(|c| c.name.as_str()).collect();
    golden_names.sort();
    result_names.sort();

    assert_eq!(
        golden_names, result_names,
        "컴포넌트 목록이 골든 스냅샷과 일치해야 함"
    );
}

#[test]
fn component_types_match() {
    let golden = load_golden();
    let result = run_analysis();

    for gc in &golden.components {
        let rc = result
            .components
            .iter()
            .find(|c| c.name == gc.name)
            .unwrap_or_else(|| panic!("컴포넌트 {} 없음", gc.name));

        assert_eq!(
            format!("{:?}", rc.component_type),
            format!("{:?}", gc.component_type),
            "컴포넌트 {} 타입 불일치",
            gc.name
        );
    }
}

#[test]
fn component_children_match() {
    let golden = load_golden();
    let result = run_analysis();

    for gc in &golden.components {
        let rc = result
            .components
            .iter()
            .find(|c| c.name == gc.name)
            .unwrap_or_else(|| panic!("컴포넌트 {} 없음", gc.name));

        let mut gc_children = gc.children.clone();
        let mut rc_children = rc.children.clone();
        gc_children.sort();
        rc_children.sort();

        assert_eq!(
            gc_children, rc_children,
            "컴포넌트 {} children 불일치",
            gc.name
        );
    }
}

#[test]
fn component_used_by_match() {
    let golden = load_golden();
    let result = run_analysis();

    for gc in &golden.components {
        let rc = result
            .components
            .iter()
            .find(|c| c.name == gc.name)
            .unwrap_or_else(|| panic!("컴포넌트 {} 없음", gc.name));

        let mut gc_used = gc.used_by.clone();
        let mut rc_used = rc.used_by.clone();
        gc_used.sort();
        rc_used.sort();

        assert_eq!(
            gc_used, rc_used,
            "컴포넌트 {} used_by 불일치",
            gc.name
        );
    }
}

#[test]
fn component_hooks_match() {
    let golden = load_golden();
    let result = run_analysis();

    for gc in &golden.components {
        let rc = result
            .components
            .iter()
            .find(|c| c.name == gc.name)
            .unwrap_or_else(|| panic!("컴포넌트 {} 없음", gc.name));

        let mut gc_hooks = gc.hooks.clone();
        let mut rc_hooks = rc.hooks.clone();
        gc_hooks.sort();
        rc_hooks.sort();

        assert_eq!(
            gc_hooks, rc_hooks,
            "컴포넌트 {} hooks 불일치",
            gc.name
        );
    }
}

// ============================================================
// 라우트 감지
// ============================================================

#[test]
fn finds_all_routes() {
    let golden = load_golden();
    let result = run_analysis();

    let mut golden_paths: Vec<&str> = golden.routes.iter().map(|r| r.path.as_str()).collect();
    let mut result_paths: Vec<&str> = result.routes.iter().map(|r| r.path.as_str()).collect();
    golden_paths.sort();
    result_paths.sort();

    assert_eq!(
        golden_paths, result_paths,
        "라우트 경로 목록이 일치해야 함"
    );
}

#[test]
fn route_component_mapping_matches() {
    let golden = load_golden();
    let result = run_analysis();

    for gr in &golden.routes {
        let rr = result
            .routes
            .iter()
            .find(|r| r.path == gr.path)
            .unwrap_or_else(|| panic!("라우트 {} 없음", gr.path));

        assert_eq!(
            rr.component, gr.component,
            "라우트 {} 컴포넌트 매핑 불일치",
            gr.path
        );
    }
}

// ============================================================
// API 클라이언트 감지
// ============================================================

#[test]
fn finds_all_api_clients() {
    let golden = load_golden();
    let result = run_analysis();

    let golden_apis: Vec<(&str, &str)> = golden
        .api_clients
        .iter()
        .map(|a| (a.method.as_str(), a.url_pattern.as_str()))
        .collect();

    for (method, url) in &golden_apis {
        let found = result
            .api_clients
            .iter()
            .any(|a| a.method == *method && a.url_pattern == *url);
        assert!(found, "API {} {} 가 결과에 없음", method, url);
    }

    assert_eq!(
        golden.api_clients.len(),
        result.api_clients.len(),
        "API 클라이언트 총 개수 불일치"
    );
}

#[test]
fn api_function_names_match() {
    let golden = load_golden();
    let result = run_analysis();

    for ga in &golden.api_clients {
        let ra = result
            .api_clients
            .iter()
            .find(|a| a.method == ga.method && a.url_pattern == ga.url_pattern)
            .unwrap_or_else(|| panic!("API {} {} 없음", ga.method, ga.url_pattern));

        assert_eq!(
            ra.function_name, ga.function_name,
            "API {} {} function_name 불일치",
            ga.method, ga.url_pattern
        );
    }
}

// ============================================================
// 함수 감지
// ============================================================

#[test]
fn finds_all_functions() {
    let golden = load_golden();
    let result = run_analysis();

    let mut golden_fns: Vec<&str> = golden.functions.iter().map(|f| f.name.as_str()).collect();
    let mut result_fns: Vec<&str> = result.functions.iter().map(|f| f.name.as_str()).collect();
    golden_fns.sort();
    result_fns.sort();

    assert_eq!(
        golden_fns, result_fns,
        "함수 목록이 일치해야 함"
    );
}

#[test]
fn function_call_relationships_match() {
    let golden = load_golden();
    let result = run_analysis();

    for gf in &golden.functions {
        let rf = result
            .functions
            .iter()
            .find(|f| f.name == gf.name && f.file_path.replace('\\', "/") == gf.file_path.replace('\\', "/"))
            .unwrap_or_else(|| panic!("함수 {} ({}) 없음", gf.name, gf.file_path));

        let mut gc = gf.calls.clone();
        let mut rc = rf.calls.clone();
        gc.sort();
        rc.sort();

        assert_eq!(gc, rc, "함수 {} calls 불일치", gf.name);
    }
}

#[test]
fn function_called_by_relationships_match() {
    let golden = load_golden();
    let result = run_analysis();

    for gf in &golden.functions {
        let rf = result
            .functions
            .iter()
            .find(|f| f.name == gf.name && f.file_path.replace('\\', "/") == gf.file_path.replace('\\', "/"))
            .unwrap_or_else(|| panic!("함수 {} ({}) 없음", gf.name, gf.file_path));

        let mut gcb = gf.called_by.clone();
        let mut rcb = rf.called_by.clone();
        gcb.sort();
        rcb.sort();

        assert_eq!(gcb, rcb, "함수 {} called_by 불일치", gf.name);
    }
}

// ============================================================
// 의존성 감지
// ============================================================

#[test]
fn finds_all_dependencies() {
    let golden = load_golden();
    let result = run_analysis();

    let mut golden_deps: Vec<&str> = golden.dependencies.iter().map(|d| d.name.as_str()).collect();
    let mut result_deps: Vec<&str> = result.dependencies.iter().map(|d| d.name.as_str()).collect();
    golden_deps.sort();
    result_deps.sort();

    assert_eq!(
        golden_deps, result_deps,
        "의존성 목록이 일치해야 함"
    );
}

// ============================================================
// 상태 관리 스토어 감지
// ============================================================

#[test]
fn finds_zustand_store() {
    let result = run_analysis();
    let zustand_stores: Vec<_> = result
        .state_stores
        .iter()
        .filter(|s| s.store_type == "zustand")
        .collect();

    assert!(
        !zustand_stores.is_empty(),
        "Zustand 스토어가 감지되어야 함"
    );

    let app_store = zustand_stores
        .iter()
        .find(|s| s.name == "useAppStore")
        .expect("useAppStore 가 감지되어야 함");

    assert_eq!(app_store.store_type, "zustand");

    // state 키 확인
    let state_keys = &app_store.state_keys;
    assert!(state_keys.contains(&"user".to_string()), "state에 user가 있어야 함");
    assert!(state_keys.contains(&"theme".to_string()), "state에 theme이 있어야 함");
    assert!(state_keys.contains(&"notifications".to_string()), "state에 notifications가 있어야 함");

    // 액션 확인
    let actions = &app_store.actions;
    assert!(actions.contains(&"setUser".to_string()), "actions에 setUser가 있어야 함");
    assert!(actions.contains(&"toggleTheme".to_string()), "actions에 toggleTheme이 있어야 함");
    assert!(actions.contains(&"clearNotifications".to_string()), "actions에 clearNotifications이 있어야 함");
}

// ============================================================
// 동적 API URL 추출
// ============================================================

#[test]
fn detects_template_literal_api_urls() {
    let result = run_analysis();
    let api = result
        .api_clients
        .iter()
        .find(|a| a.function_name == "fetchUserProfile");
    assert!(api.is_some(), "fetchUserProfile API가 감지되어야 함");
    let api = api.unwrap();
    assert!(
        api.url_pattern.contains("{userId}"),
        "템플릿 리터럴 URL에서 동적 파라미터 추출: {:?}",
        api.url_pattern
    );
}

#[test]
fn detects_string_concat_api_urls() {
    let result = run_analysis();
    let api = result
        .api_clients
        .iter()
        .find(|a| a.function_name == "deleteItem");
    assert!(api.is_some(), "deleteItem API가 감지되어야 함");
    let api = api.unwrap();
    assert!(
        api.url_pattern.contains("{category}") && api.url_pattern.contains("{id}"),
        "문자열 연결 URL에서 동적 파라미터 추출: {:?}",
        api.url_pattern
    );
}

// ============================================================
// 증분 분석 캐시
// ============================================================

#[test]
fn incremental_analysis_creates_cache() {
    // 충돌 방지: 임시 디렉토리에 fixture 복사
    let tmp_dir = std::env::temp_dir().join("reverseng-test-incremental");
    let _ = std::fs::remove_dir_all(&tmp_dir);
    copy_dir_recursive(fixture_path(), &tmp_dir);

    let cache_file = tmp_dir.join(".reverse-engine/analysis-cache.json");
    let _ = std::fs::remove_file(&cache_file);

    // 1회차: 전체 분석 → 캐시 생성
    let result1 = analyze_project(&tmp_dir).expect("분석 실행 실패");
    assert!(cache_file.exists(), "분석 후 캐시 파일이 생성되어야 함");

    // 캐시 로드 검증
    let cache = AnalysisCache::load(&tmp_dir).expect("캐시 로드 가능해야 함");
    assert_eq!(cache.result.components.len(), result1.components.len());

    // 2회차: 캐시 히트 → 동일 결과
    let result2 = analyze_project(&tmp_dir).expect("분석 실행 실패");
    assert_eq!(result1.components.len(), result2.components.len());
    assert_eq!(result1.functions.len(), result2.functions.len());
    assert_eq!(result1.api_clients.len(), result2.api_clients.len());

    // 정리
    let _ = std::fs::remove_dir_all(&tmp_dir);
}

fn copy_dir_recursive(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            // .reverse-engine 디렉토리는 건너뜀
            if entry.file_name() == ".reverse-engine" {
                continue;
            }
            copy_dir_recursive(&src_path, &dst_path);
        } else {
            std::fs::copy(&src_path, &dst_path).unwrap();
        }
    }
}

// ============================================================
// 회귀 방지: 전체 개수 일관성
// ============================================================

#[test]
fn result_counts_match_golden() {
    let golden = load_golden();
    let result = run_analysis();

    assert_eq!(result.components.len(), golden.components.len(), "컴포넌트 수");
    assert_eq!(result.routes.len(), golden.routes.len(), "라우트 수");
    assert_eq!(result.functions.len(), golden.functions.len(), "함수 수");
    assert_eq!(result.api_clients.len(), golden.api_clients.len(), "API 클라이언트 수");
    assert_eq!(result.dependencies.len(), golden.dependencies.len(), "의존성 수");
}
