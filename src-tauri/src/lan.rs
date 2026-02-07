use crate::core::{is_running, stop};
use tauri::{
    http::{header::LOCATION, StatusCode},
    AppHandle, Manager,
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

async fn probe_dns_server(dns: String, tx: Option<mpsc::Sender<(String, std::time::Duration)>>) {
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
            let padded_dns: String = format!("{:<20}", dns);
            log::info!(
                "✓ DNS {} responded successfully, latency: {:?}",
                padded_dns,
                elapsed
            );

            // 如果发送通道存在，尝试发送结果
            // If the sending channel exists, try to send the result
            if let Some(tx) = tx {
                // 发不进去也无所谓，说明已经有人先占了
                // If it can't be sent, it doesn't matter, someone else has taken it
                let _ = tx.try_send((dns, elapsed));
            }
        }
        _ => {
            let padded_dns: String = format!("{:<20}", dns);
            log::info!("✗ DNS {} failed or timed out", padded_dns);
        }
    }
}

pub async fn get_best_dns_server() -> Option<String> {
    let first_dns = DNSSERVERDICT[0].to_string();

    // buffer 设 1，第一个成功的 send 立刻送进去，主流程立刻收到
    // Set the buffer to 1, the first successful send goes in immediately, and the main process receives it immediately
    let (tx, mut rx) = mpsc::channel::<(String, std::time::Duration)>(1);

    for dns in DNSSERVERDICT {
        let dns = dns.to_string();
        let tx: mpsc::Sender<(String, std::time::Duration)> = tx.clone();

        tokio::spawn(async move {
            probe_dns_server(dns, Some(tx)).await;
        });
    }

    // 原始的 tx 必须 drop，否则 rx.recv() 永远不会返回 None
    // The original tx must be dropped, otherwise rx.recv() will never return None
    drop(tx);

    // wait for the first successful DNS server or all to fail
    match rx.recv().await {
        Some((dns, _)) => {
            let padded_dns: String = format!("{:<20}", dns);
            log::info!("✓ DNS {} is selected as the optimal server", padded_dns);
            Some(dns)
        }
        None => {
            // All DNS servers failed, fall back to the first one
            let padded_dns: String = format!("{:<20}", first_dns);
            log::info!("✗ All DNS servers failed, falling back to: {}", padded_dns);
            Some(first_dns)
        }
    }
}

// 获取最佳本地 DNS 服务器的命令
// Command to get the optimal local DNS server
#[tauri::command]
pub async fn get_optimal_local_dns_server(app: AppHandle) -> Option<String> {
    use crate::app_status::AppData;

    let app_data = app.state::<AppData>();
    let running = { is_running(app.clone(), app_data.get_clash_secret().unwrap()).await };

    if running {
        // sing-box 运行中，尝试使用缓存的 DNS 结果，避免探测走代理导致误判。
        // When sing-box is running, try to use the cached DNS result to avoid misjudgment caused by probing through the proxy.
        if let Some(cached) = app_data.get_cached_dns() {
            log::info!("sing-box is running, using cached DNS: {}", cached);
            return Some(cached);
        }
    }
    // sing-box 未运行或无缓存，获取最佳本地 DNS 并更新缓存
    // sing-box is not running or no cache, get the optimal local DNS and update the cache
    log::info!("Fetching best DNS server...");
    let best_dns = get_best_dns_server().await;
    if let Some(ref dns) = best_dns {
        app_data.set_cached_dns(Some(dns.clone()));
        log::info!("Updated cached DNS: {}", dns);
    }

    best_dns
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio;
    fn init_logger() {
        let _ = env_logger::builder()
            .is_test(true)
            .filter_level(log::LevelFilter::Info)
            .try_init();
    }
    #[test]
    fn test_is_private_ip_basic() {
        init_logger();
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("192.168.1.1"));
        assert!(!is_private_ip("8.8.8.8"));
    }

    #[test]
    fn test_get_best_dns_server_returns_some() {
        init_logger();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(get_best_dns_server());
        assert!(res.is_some());
    }

    #[test]
    fn test_all_dns_servers() {
        init_logger();
        let rt = tokio::runtime::Runtime::new().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));
        rt.block_on(async {
            let mut handles = Vec::new();
            for dns in DNSSERVERDICT {
                let dns = dns.to_string();
                let handle = tokio::spawn(async move {
                    probe_dns_server(dns, None).await;
                });
                handles.push(handle);
            }
            // wait for all tasks to complete
            for handle in handles {
                let _ = handle.await;
            }
        });
    }
}
