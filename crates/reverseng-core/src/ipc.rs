use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::process::Stdio;

/// Rust → Node.js 프로세스 통신
///
/// Rust CLI가 Node.js 스크립트를 subprocess로 실행하고
/// JSON stdin/stdout으로 데이터를 교환한다.

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

/// Node.js 스크립트를 실행하고 JSON 결과를 받는다
pub async fn call_node_script(
    script_path: &str,
    request: &IpcRequest,
) -> Result<IpcResponse> {
    let _input = serde_json::to_string(request)?;

    let output = tokio::process::Command::new("node")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?
        .wait_with_output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Ok(IpcResponse {
            success: false,
            data: None,
            error: Some(format!("Node.js process failed: {}", stderr)),
        });
    }

    let stdout = String::from_utf8(output.stdout)?;

    // stdout에서 마지막 JSON 라인을 파싱 (Node.js 로그와 분리)
    let response: IpcResponse = if let Some(json_line) = stdout.lines().rev().find(|l| l.starts_with('{')) {
        serde_json::from_str(json_line)?
    } else {
        IpcResponse {
            success: true,
            data: Some(serde_json::Value::String(stdout)),
            error: None,
        }
    };

    Ok(response)
}

/// Node.js 프로세스를 stdin을 통해 스트리밍으로 통신
pub async fn spawn_node_with_stdin(
    script_path: &str,
    input_json: &str,
) -> Result<String> {
    use tokio::io::AsyncWriteExt;

    let mut child = tokio::process::Command::new("node")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input_json.as_bytes()).await?;
        stdin.shutdown().await?;
    }

    let output = child.wait_with_output().await?;
    let stdout = String::from_utf8(output.stdout)?;
    Ok(stdout)
}
