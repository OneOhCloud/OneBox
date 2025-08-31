use crate::core::stop;
use tauri::{
    http::{header::LOCATION, StatusCode},
    AppHandle,
};
use tauri_plugin_http::reqwest::{self, redirect::Policy};
use tokio::process::Command;
use webbrowser;

const DEFAULT_CAPTIVE_URL: &str = "http://captive.oneoh.cloud";

fn build_no_redirect_client() -> reqwest::Client {
    reqwest::ClientBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .unwrap()
}

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
pub async fn open_browser(app: AppHandle, url: String) -> Result<(), String> {
    // zh:需要网络认证，尝试停止和重置代理。
    // en: Network authentication required, try to stop and reset the proxy.
    stop(app).await.unwrap_or_else(|e| {
        log::error!("Failed to stop app: {}", e);
    });

    // 使用 webbrowser 库打开浏览器
    // zh: 如果有重定向，则打开浏览器并返回 false
    // en: If there is a redirect, open the browser and return false
    match webbrowser::open(&url) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to open browser: {}", e)),
    }
}

#[tauri::command]
pub async fn check_captive_portal_status() -> i8 {
    // -1 代表无法访问, 0 代表可以访问, 1 代表需要认证

    // 如果需要替换其他检测地址，务必满足以下条件
    // - 中国大陆以及海外可访问
    // - 支持无重定向的 http 协议
    // - 解析记录仅 IPv4，如果有 IPv6 记录可能在纯 IPv4 网络下失败导致误报。

    let url = "http://connectivitycheck.gstatic.com/generate_204";

    let client = build_no_redirect_client();
    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status();
            if status == StatusCode::NO_CONTENT {
                0
            } else if status.is_redirection() {
                1
            } else {
                log::error!("Unexpected status code: {}", status);
                -1
            }
        }
        Err(_) => -1,
    }
}

#[tauri::command]
pub async fn get_captive_redirect_url() -> String {
    let client = build_no_redirect_client();

    match client.get(DEFAULT_CAPTIVE_URL).send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_redirection() {
                response
                    .headers()
                    .get(LOCATION)
                    .and_then(|h| h.to_str().ok())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| DEFAULT_CAPTIVE_URL.to_string())
            } else {
                log::error!("Unexpected status code: {}", status);
                DEFAULT_CAPTIVE_URL.to_string()
            }
        }
        Err(_) => DEFAULT_CAPTIVE_URL.to_string(),
    }
}

#[tauri::command]
pub async fn ping_google() -> bool {
    let proxy = format!("http://{}:{}", "127.0.0.1", 6789);
    let client = reqwest::ClientBuilder::new()
        .proxy(reqwest::Proxy::all(&proxy).unwrap())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();

    match client
        .get("https://www.google.com/generate_204")
        .send()
        .await
    {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}
