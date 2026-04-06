use anyhow::Result;
use reverseng_core::types::analyzer::DetectedFramework;
use std::path::Path;

/// 프로젝트 디렉토리에서 프레임워크 자동 감지
pub fn detect_framework(source_path: &Path) -> Result<DetectedFramework> {
    // package.json 확인
    let pkg_path = source_path.join("package.json");
    if pkg_path.exists() {
        let content = std::fs::read_to_string(&pkg_path)?;
        return Ok(detect_from_package_json(&content));
    }

    // requirements.txt / pyproject.toml 확인 (Python)
    if source_path.join("requirements.txt").exists()
        || source_path.join("pyproject.toml").exists()
    {
        return Ok(DetectedFramework::Python);
    }

    Ok(DetectedFramework::Unknown)
}

fn detect_from_package_json(content: &str) -> DetectedFramework {
    let content_lower = content.to_lowercase();

    // 순서가 중요: 구체적인 것부터 확인
    if content_lower.contains("\"next\"") || content_lower.contains("\"next/") {
        DetectedFramework::NextJs
    } else if content_lower.contains("\"nuxt\"") {
        DetectedFramework::Nuxt
    } else if content_lower.contains("\"@angular/core\"") {
        DetectedFramework::Angular
    } else if content_lower.contains("\"svelte\"") {
        DetectedFramework::Svelte
    } else if content_lower.contains("\"vue\"") {
        DetectedFramework::Vue
    } else if content_lower.contains("\"react\"") {
        DetectedFramework::React
    } else {
        DetectedFramework::Unknown
    }
}
