use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use reverseng_core::types::analyzer::AnalysisResult;

const CACHE_DIR: &str = ".reverse-engine";
const CACHE_FILE: &str = "analysis-cache.json";

/// 파일별 해시와 분석 결과를 저장하는 캐시
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisCache {
    pub version: u32,
    pub file_hashes: HashMap<String, String>,
    pub result: AnalysisResult,
}

impl AnalysisCache {
    const CURRENT_VERSION: u32 = 1;

    fn cache_path(project_root: &Path) -> PathBuf {
        project_root.join(CACHE_DIR).join(CACHE_FILE)
    }

    /// 캐시를 디스크에서 로드. 없거나 버전 불일치면 None
    pub fn load(project_root: &Path) -> Option<Self> {
        let path = Self::cache_path(project_root);
        let content = std::fs::read_to_string(&path).ok()?;
        let cache: Self = serde_json::from_str(&content).ok()?;
        if cache.version != Self::CURRENT_VERSION {
            tracing::info!("캐시 버전 불일치, 전체 재분석 필요");
            return None;
        }
        Some(cache)
    }

    /// 캐시를 디스크에 저장
    pub fn save(&self, project_root: &Path) -> Result<()> {
        let dir = project_root.join(CACHE_DIR);
        std::fs::create_dir_all(&dir)?;
        let path = Self::cache_path(project_root);
        std::fs::write(&path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn new(file_hashes: HashMap<String, String>, result: AnalysisResult) -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            file_hashes,
            result,
        }
    }
}

/// 파일의 SHA256 해시 계산
pub fn hash_file(path: &Path) -> Result<String> {
    let content = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    Ok(hex::encode(hasher.finalize()))
}

/// 변경된 파일 목록 계산
pub struct IncrementalDiff {
    /// 새로 추가되거나 변경된 파일 (재분석 필요)
    pub changed: Vec<PathBuf>,
    /// 삭제된 파일 (결과에서 제거 필요)
    pub deleted: Vec<String>,
    /// 변경 없는 파일
    pub unchanged_count: usize,
}

pub fn compute_diff(
    current_files: &[(PathBuf, String)],
    cached_hashes: &HashMap<String, String>,
) -> IncrementalDiff {
    let mut changed = Vec::new();
    let mut unchanged_count = 0;

    let current_keys: std::collections::HashSet<String> = current_files
        .iter()
        .map(|(p, _)| p.to_string_lossy().replace('\\', "/"))
        .collect();

    // 변경/추가 감지
    for (path, hash) in current_files {
        let key = path.to_string_lossy().replace('\\', "/");
        match cached_hashes.get(&key) {
            Some(cached_hash) if cached_hash == hash => unchanged_count += 1,
            _ => changed.push(path.clone()),
        }
    }

    // 삭제 감지
    let deleted: Vec<String> = cached_hashes
        .keys()
        .filter(|k| !current_keys.contains(k.as_str()))
        .cloned()
        .collect();

    IncrementalDiff {
        changed,
        deleted,
        unchanged_count,
    }
}
