use crate::core::stop;
use tauri::{
    http::{header::LOCATION, StatusCode},
    AppHandle,
};
use tauri_plugin_http::reqwest::{self, redirect::Policy};
use tokio::process::Command;
use tokio::sync::mpsc;

const DEFAULT_CAPTIVE_URL: &str = "http://captive.oneoh.cloud";

// Global DNS server list for performance testing
static DNSSERVERDICT: [&str; 30] = [
    "1.0.0.1", // Cloudflare DNS
    "1.1.1.1", // Cloudflare DNS
    "1.2.4.8", // CN DNS
    "101.101.101.101",
    "101.102.103.104",
    "114.114.114.114", // CN 114DNS
    "114.114.115.115", // CN 114DNS
    "119.29.29.29",    // CN Tencent DNS
    "149.112.112.112",
    "149.112.112.9",
    "180.184.1.1",
    "180.184.2.2",
    "180.76.76.76",
    "2.188.21.131", // Iran Yokhdi! DNS
    "2.188.21.132", // Iran Yokhdi! DNS
    "2.189.44.44",  // Iran DNS
    "202.175.3.3",
    "202.175.3.8",
    "208.67.220.220", // OpenDNS
    "208.67.220.222", // OpenDNS
    "208.67.222.220", // OpenDNS
    "208.67.222.222", // OpenDNS
    "210.2.4.8",
    "223.5.5.5", // CN Alibaba DNS
    "223.6.6.6", // CN Alibaba DNS
    "77.88.8.1",
    "77.88.8.8",
    "8.8.4.4", // Google DNS
    "8.8.8.8", // Google DNS
    "9.9.9.9", // Quad9 DNS
];

#[cfg(target_os = "macos")]
fn is_private_ip(ip: &str) -> bool {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return false;
    }

    let octets: Result<Vec<u8>, _> = parts.iter().map(|s| s.parse()).collect();
    if let Ok(octets) = octets {
        // 10.0.0.0/8
        if octets[0] == 10 {
            return true;
        }
        // 172.16.0.0/12
        if octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 {
            return true;
        }
        // 192.168.0.0/16
        if octets[0] == 192 && octets[1] == 168 {
            return true;
        }
    }
    false
}

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
            .arg("ifconfig")
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let ifconfig_output = String::from_utf8_lossy(&output.stdout);

        // 解析ifconfig输出，查找最合适的局域网IP
        let mut best_ip: Option<String> = None;
        let mut current_interface = String::new();
        let mut is_up = false;
        let mut is_running = false;

        for line in ifconfig_output.lines() {
            // 检测新的网络接口
            if !line.starts_with('\t') && !line.starts_with(' ') && line.contains(':') {
                if let Some(interface) = line.split(':').next() {
                    current_interface = interface.to_string();
                    is_up = line.contains("UP");
                    is_running = line.contains("RUNNING");
                }
            }

            // 查找inet地址
            if line.trim().starts_with("inet ") && is_up && is_running {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let ip = parts[1];

                    // 跳过回环地址
                    if ip.starts_with("127.") {
                        continue;
                    }

                    // 跳过链路本地地址
                    if ip.starts_with("169.254.") {
                        continue;
                    }

                    // 检查是否为私有网络地址
                    if is_private_ip(ip) {
                        // 优先级：en0 (以太网/WiFi) > en1 > 其他接口
                        if current_interface == "en0" {
                            return Ok(ip.to_string());
                        } else if best_ip.is_none() {
                            best_ip = Some(ip.to_string());
                        }
                    }
                }
            }
        }

        best_ip.ok_or_else(|| "No LAN IP found".to_string())
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

    let url = "http://captive.apple.com/";

    let client = build_no_redirect_client();
    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status();
            if status == StatusCode::OK {
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

async fn get_best_dns_server() -> Option<String> {
    let dns_servers = DNSSERVERDICT;

    if dns_servers.is_empty() {
        return None;
    }

    let first_dns = dns_servers[0].to_string();

    // buffer 设 1，第一个成功的 send 立刻送进去，主流程立刻收到
    let (tx, mut rx) = mpsc::channel::<(String, std::time::Duration)>(1);

    for dns in dns_servers {
        let dns = dns.to_string();
        let tx: mpsc::Sender<(String, std::time::Duration)> = tx.clone();

        tokio::spawn(async move {
            use std::net::SocketAddr;
            use tokio::net::UdpSocket;
            use tokio::time::{timeout, Duration};

            let start = std::time::Instant::now();

            let ns_addr: SocketAddr = match format!("{}:53", dns).parse() {
                Ok(addr) => addr,
                Err(_) => return,
            };
            let bind_addr = if ns_addr.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            };

            let socket = match UdpSocket::bind(bind_addr).await {
                Ok(s) => s,
                Err(_) => return,
            };
            if socket.connect(ns_addr).await.is_err() {
                return;
            }

            let mut payload = vec![
                0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ];
            payload.extend_from_slice(&[
                3, b'w', b'w', b'w', 5, b'b', b'a', b'i', b'd', b'u', 3, b'c', b'o', b'm', 0,
            ]);
            payload.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);

            if socket.send(&payload).await.is_err() {
                return;
            }

            let mut buf = [0u8; 512];
            match timeout(Duration::from_millis(500), socket.recv(&mut buf)).await {
                Ok(Ok(len)) if len >= 12 && buf[0] == 0x12 && buf[1] == 0x34 => {
                    let elapsed = start.elapsed();
                    log::info!("✓ DNS {} 响应成功，延迟: {:?}", dns, elapsed);
                    // 发不进去也无所谓，说明已经有人先占了
                    let _ = tx.try_send((dns, elapsed));
                }
                _ => {
                    log::info!("✗ DNS {} 失败或超时", dns);
                }
            }
            // tx 在这里自动 drop
        });
    }

    // 原始的 tx 必须 drop，否则 rx.recv() 永远不会返回 None
    drop(tx);

    // 等待第一个成功响应
    match rx.recv().await {
        Some((dns, _)) => {
            log::info!("最终选择的 DNS: {}", dns);
            Some(dns)
        }
        None => {
            // 所有 sender 都 drop 了，即全部任务失败
            log::info!("所有 DNS 均失败，回退到: {}", first_dns);
            Some(first_dns)
        }
    }
}

#[tauri::command]
pub async fn get_optimal_dns_server() -> Option<String> {
    get_best_dns_server().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio;
    // 若需要其它测试（如文件相关），也可以在此处加入相关 use

    #[test]
    fn test_is_private_ip_basic() {
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("192.168.1.1"));
        assert!(!is_private_ip("8.8.8.8"));
    }

    #[test]
    fn test_get_best_dns_server_returns_some() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(get_best_dns_server());
        println!("Best DNS server: {:?}", res);
        assert!(res.is_some());
    }
}
