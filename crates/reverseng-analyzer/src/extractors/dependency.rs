use anyhow::Result;
use reverseng_core::types::analyzer::{DependencyInfo, DependencyType};
use std::path::Path;

/// package.json에서 의존성 정보 추출
pub fn extract_dependencies(source_path: &Path) -> Result<Vec<DependencyInfo>> {
    let mut deps = Vec::new();

    // Node.js package.json
    let pkg_path = source_path.join("package.json");
    if pkg_path.exists() {
        let content = std::fs::read_to_string(&pkg_path)?;
        let pkg: serde_json::Value = serde_json::from_str(&content)?;

        if let Some(dependencies) = pkg.get("dependencies").and_then(|d| d.as_object()) {
            for (name, version) in dependencies {
                deps.push(DependencyInfo {
                    name: name.clone(),
                    current_version: version.as_str().unwrap_or("").to_string(),
                    latest_version: None,
                    dep_type: DependencyType::Production,
                    license: None,
                    vulnerabilities: vec![],
                });
            }
        }

        if let Some(dev_deps) = pkg.get("devDependencies").and_then(|d| d.as_object()) {
            for (name, version) in dev_deps {
                deps.push(DependencyInfo {
                    name: name.clone(),
                    current_version: version.as_str().unwrap_or("").to_string(),
                    latest_version: None,
                    dep_type: DependencyType::Development,
                    license: None,
                    vulnerabilities: vec![],
                });
            }
        }

        if let Some(peer_deps) = pkg.get("peerDependencies").and_then(|d| d.as_object()) {
            for (name, version) in peer_deps {
                deps.push(DependencyInfo {
                    name: name.clone(),
                    current_version: version.as_str().unwrap_or("").to_string(),
                    latest_version: None,
                    dep_type: DependencyType::Peer,
                    license: None,
                    vulnerabilities: vec![],
                });
            }
        }
    }

    // Python requirements.txt
    let req_path = source_path.join("requirements.txt");
    if req_path.exists() {
        let content = std::fs::read_to_string(&req_path)?;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let (name, version) = if let Some(idx) = line.find("==") {
                (line[..idx].to_string(), line[idx + 2..].to_string())
            } else if let Some(idx) = line.find(">=") {
                (line[..idx].to_string(), format!(">={}", &line[idx + 2..]))
            } else {
                (line.to_string(), "*".to_string())
            };

            deps.push(DependencyInfo {
                name,
                current_version: version,
                latest_version: None,
                dep_type: DependencyType::Production,
                license: None,
                vulnerabilities: vec![],
            });
        }
    }

    Ok(deps)
}
