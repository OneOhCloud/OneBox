use crate::core::stop;
use tauri::{
    http::{header::LOCATION, StatusCode},
    AppHandle,
};
use tauri_plugin_http::reqwest::{self, redirect::Policy};
use tokio::process::Command;

const DEFAULT_CAPTIVE_URL: &str = "http://captive.oneoh.cloud";

static DNSSERVERDICT: [&str; 8] = [
    "223.6.6.6",
    "223.5.5.5",
    "119.29.29.29",
    "114.114.114.114",
    "180.184.1.1",
    "180.184.2.2",
    "8.8.8.8",
    "1.1.1.1",
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

    println!("开始测试 DNS 服务器列表: {:?}", dns_servers);

    let first_dns = dns_servers[0].to_string();
    let mut tasks = vec![];

    for dns in dns_servers {
        let dns = dns.to_string();
        let task = tokio::spawn(async move {
            use std::net::SocketAddr;
            use tokio::net::UdpSocket;
            use tokio::time::{timeout, Duration};

            let start = std::time::Instant::now();

            // 构造 UDP 地址并绑定临时本地端口
            let ns_addr: SocketAddr = format!("{}:53", dns).parse().ok()?;
            let bind_addr = if ns_addr.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            };
            let socket = UdpSocket::bind(bind_addr).await.ok()?;
            socket.connect(ns_addr).await.ok()?;

            // 构造一个标准的 DNS 查询包（查询 www.baidu.com 的 A 记录）
            // DNS Header (12 bytes) + Query Section
            let mut payload = vec![
                0x12, 0x34, // Transaction ID
                0x01, 0x00, // Flags: standard query
                0x00, 0x01, // Questions: 1
                0x00, 0x00, // Answer RRs: 0
                0x00, 0x00, // Authority RRs: 0
                0x00, 0x00, // Additional RRs: 0
            ];
            // Query: www.baidu.com -> 3www5baidu3com0
            payload.extend_from_slice(&[
                3, b'w', b'w', b'w', 5, b'b', b'a', b'i', b'd', b'u', 3, b'c', b'o', b'm', 0,
            ]);
            payload.extend_from_slice(&[
                0x00, 0x01, // Type: A
                0x00, 0x01, // Class: IN
            ]);

            if socket.send(&payload).await.is_err() {
                return None;
            }

            let mut buf = [0u8; 512];
            match timeout(Duration::from_millis(500), socket.recv(&mut buf)).await {
                Ok(Ok(len)) if len >= 12 => {
                    // 验证这是一个有效的 DNS 响应（至少有 DNS header）
                    // 检查 Transaction ID 是否匹配
                    if buf[0] == 0x12 && buf[1] == 0x34 {
                        let elapsed = start.elapsed();
                        println!("✓ DNS {} 响应成功，延迟: {:?}", dns, elapsed);
                        Some((dns, elapsed))
                    } else {
                        println!("✗ DNS {} 响应无效 (Transaction ID 不匹配)", dns);
                        None
                    }
                }
                Ok(Ok(len)) => {
                    println!("✗ DNS {} 响应过短 (长度: {})", dns, len);
                    None
                }
                Ok(Err(e)) => {
                    println!("✗ DNS {} 接收失败: {}", dns, e);
                    None
                }
                Err(_) => {
                    println!("✗ DNS {} 超时", dns);
                    None
                }
            }
        });
        tasks.push(task);
    }

    // 找出响应最快的 DNS 服务器
    let mut fastest: Option<(String, std::time::Duration)> = None;
    for task in tasks {
        if let Ok(result) = task.await {
            if let Some((dns, duration)) = result {
                if fastest.is_none() || duration < fastest.as_ref().unwrap().1 {
                    fastest = Some((dns, duration));
                }
            }
        }
    }

    // 如果所有 DNS 都失败，返回第一个 DNS
    let result = fastest.map(|(dns, _)| dns).unwrap_or(first_dns.clone());
    println!("最终选择的 DNS: {}", result);
    Some(result)
}

#[tauri::command]
pub async fn get_optimal_dns_server() -> Option<String> {
    get_best_dns_server().await
}
#[cfg(test)]
#[path = "lan_tests.rs"]
mod tests;
