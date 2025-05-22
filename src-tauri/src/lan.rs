use tauri::http::{header::LOCATION, StatusCode};
use tauri_plugin_http::reqwest::{self, redirect::Policy};
use tokio::process::Command;
use webbrowser;

#[tauri::command]
pub async fn get_lan_ip() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winbase::CREATE_NO_WINDOW;

        // 先执行 ipconfig 命令获取所有网络配置
        let output = Command::new("ipconfig")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let output_str = String::from_utf8_lossy(&output.stdout);

        // 使用 Rust 代码解析结果
        for line in output_str.lines() {
            if line.contains("IPv4") && !line.contains("169.254.") && !line.contains("100.127.") {
                if let Some(ip) = line.split(':').nth(1) {
                    return Ok(ip.trim().to_string());
                }
            }
        }

        Err("unknown".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("bash")
            .arg("-c")
            .arg("ip -4 addr show | awk '/inet /{print $2}' | cut -d/ -f1 | grep -v '^127\\.' | head -n 1")
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let ip = String::from_utf8_lossy(&output.stdout);
        Ok(ip.trim().to_string())
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("bash")
            .arg("-c")
            .arg("ifconfig | grep 'flags=' | cut -d: -f1 | xargs -I {} ipconfig getifaddr {} 2>/dev/null")
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let ip = String::from_utf8_lossy(&output.stdout);
        Ok(ip.trim().to_string())
    }
}

#[tauri::command]
pub async fn ping_apple_captive() -> bool {
    // 创建 HTTP 客户端，禁用自动重定向
    let builder = reqwest::ClientBuilder::new()
        .timeout(std::time::Duration::from_secs(4))
        .redirect(Policy::none())
        .no_proxy();

    let client = builder.build().unwrap();

    match client.get("http://captive.apple.com").send().await {
        Ok(response) => {
            let status = response.status();
            if status == StatusCode::OK {
                // 200 正常返回 true
                true
            } else if matches!(
                status,
                StatusCode::FOUND
                    | StatusCode::MOVED_PERMANENTLY
                    | StatusCode::TEMPORARY_REDIRECT
                    | StatusCode::PERMANENT_REDIRECT
            ) {
                // 重定向则打开浏览器并返回 false
                if let Some(location) = response.headers().get(LOCATION) {
                    if let Ok(redirect_url) = location.to_str() {
                        let _ = webbrowser::open(redirect_url);
                    }
                }
                false
            } else {
                // 其他非预期状态返回 false
                false
            }
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn ping_google() -> bool {
    let proxy = format!("http://{}:{}", "127.0.0.1", 6789);
    let client = reqwest::ClientBuilder::new()
        .proxy(reqwest::Proxy::all(&proxy).unwrap())
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap();

    match client.get("https://www.google.com").send().await {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}
