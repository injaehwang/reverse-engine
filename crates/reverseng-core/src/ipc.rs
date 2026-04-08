use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// Rust → Node.js 프로세스 통신
///
/// 소량 데이터: stdin/stdout JSON
/// 대용량 데이터: 임시 파일 경로 교환 (stdout 버퍼 오버플로우 방지)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub command: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// 대용량 데이터를 파일 기반으로 교환하는 IPC
///
/// 1. 요청 JSON을 임시 파일에 저장
/// 2. Node.js에 --input-file, --output-file 인자로 전달
/// 3. Node.js가 결과를 output 파일에 저장
/// 4. Rust가 output 파일을 읽어서 반환
pub async fn call_node_script_file_ipc(
    script_path: &str,
    request: &IpcRequest,
) -> Result<IpcResponse> {
    let tmp_dir = std::env::temp_dir().join("reverseng-ipc");
    std::fs::create_dir_all(&tmp_dir)?;

    let id = std::process::id();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();

    let input_file = tmp_dir.join(format!("req-{}-{}.json", id, ts));
    let output_file = tmp_dir.join(format!("resp-{}-{}.json", id, ts));

    // 요청을 파일에 쓰기
    std::fs::write(&input_file, serde_json::to_string(request)?)?;

    let output = tokio::process::Command::new("node")
        .arg(script_path)
        .arg("--input-file")
        .arg(&input_file)
        .arg("--output-file")
        .arg(&output_file)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?
        .wait_with_output()
        .await?;

    // 임시 입력 파일 정리
    let _ = std::fs::remove_file(&input_file);

    if !output.status.success() {
        let _ = std::fs::remove_file(&output_file);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Ok(IpcResponse {
            success: false,
            data: None,
            error: Some(format!("Node.js process failed: {}", stderr)),
        });
    }

    // 결과 파일 읽기
    let response = if output_file.exists() {
        let content = std::fs::read_to_string(&output_file)?;
        let _ = std::fs::remove_file(&output_file);
        serde_json::from_str(&content)?
    } else {
        // fallback: stdout에서 읽기
        let stdout = String::from_utf8(output.stdout)?;
        if let Some(json_line) = stdout.lines().rev().find(|l| l.starts_with('{')) {
            serde_json::from_str(json_line)?
        } else {
            IpcResponse {
                success: true,
                data: Some(serde_json::Value::String(stdout)),
                error: None,
            }
        }
    };

    Ok(response)
}

/// 분석 결과를 파일에 저장하고 경로를 반환
pub fn write_result_file(data: &impl Serialize, prefix: &str) -> Result<PathBuf> {
    let tmp_dir = std::env::temp_dir().join("reverseng-ipc");
    std::fs::create_dir_all(&tmp_dir)?;

    let id = std::process::id();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();

    let path = tmp_dir.join(format!("{}-{}-{}.json", prefix, id, ts));
    std::fs::write(&path, serde_json::to_string(data)?)?;
    Ok(path)
}

/// 파일에서 결과를 읽어서 반환
pub fn read_result_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let content = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}
