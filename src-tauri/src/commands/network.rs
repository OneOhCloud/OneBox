//! LAN reachability + captive-portal probes exposed as Tauri commands.

use std::sync::Mutex;
use std::time::Duration;

use tauri::http::{header::LOCATION, StatusCode};
use tauri::AppHandle;
use tauri_plugin_http::reqwest::{self, redirect::Policy};
use tokio::process::Command;

const DEFAULT_CAPTIVE_URL: &str = "http://captive.oneoh.cloud";

// Only consumed by the macOS `get_lan_ip` branch; Linux uses a shell
// pipeline and Windows parses `ipconfig` output directly.
#[allow(dead_code)]
pub(crate) fn is_private_ip(ip: &str) -> bool {
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

pub(crate) fn build_no_redirect_client() -> reqwest::Client {
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

        let output = Command::new("ipconfig")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let output_str = String::from_utf8_lossy(&output.stdout);

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

        let mut best_ip: Option<String> = None;
        let mut current_interface = String::new();
        let mut is_up = false;
        let mut is_running = false;

        for line in ifconfig_output.lines() {
            if !line.starts_with('\t') && !line.starts_with(' ') && line.contains(':') {
                if let Some(interface) = line.split(':').next() {
                    current_interface = interface.to_string();
                    is_up = line.contains("UP");
                    is_running = line.contains("RUNNING");
                }
            }

            if line.trim().starts_with("inet ") && is_up && is_running {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let ip = parts[1];

                    if ip.starts_with("127.") {
                        continue;
                    }
                    if ip.starts_with("169.254.") {
                        continue;
                    }

                    if is_private_ip(ip) {
                        // en0 (Ethernet/Wi-Fi) wins; others are fallback.
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
    // Captive-portal auth often requires stopping the proxy first so the
    // browser can reach the portal's local LAN address without being
    // routed through the now-misconfigured tunnel.
    crate::core::stop(app).await.unwrap_or_else(|e| {
        log::error!("Failed to stop app: {}", e);
    });

    match webbrowser::open(&url) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to open browser: {}", e)),
    }
}

/// Any replacement host must: reach from both mainland China and overseas,
/// speak plain HTTP with no redirect required, and resolve to IPv4 only
/// (any IPv6 record causes a false positive in v4-only networks).
const CAPTIVE_PROBE_HOST: &str = "captive.apple.com";

/// Resolved separately from the HTTP request: a stalled system resolver
/// would otherwise run into the 10 s client timeout and be reported as a
/// generic unreachable network instead of a DNS failure.
const CAPTIVE_DNS_TIMEOUT: Duration = Duration::from_secs(3);

/// WLAN probe outcome. The discriminant is the wire value decoded by the
/// frontend's `toWlanStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i8)]
enum CaptiveProbeStatus {
    DnsFailed = -2,
    Unreachable = -1,
    Online = 0,
    CaptivePortal = 1,
}

/// The frontend polls every 5 s; only a status change is worth an info line.
static LAST_CAPTIVE_STATUS: Mutex<Option<CaptiveProbeStatus>> = Mutex::new(None);

fn classify_http_status(status: StatusCode) -> CaptiveProbeStatus {
    if status == StatusCode::OK {
        CaptiveProbeStatus::Online
    } else if status.is_redirection() {
        CaptiveProbeStatus::CaptivePortal
    } else {
        CaptiveProbeStatus::Unreachable
    }
}

/// reqwest's top-level message ("error sending request for url") hides the
/// cause; the source chain carries it.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

async fn resolve_captive_probe_host() -> Result<(), String> {
    match tokio::time::timeout(
        CAPTIVE_DNS_TIMEOUT,
        tokio::net::lookup_host((CAPTIVE_PROBE_HOST, 80)),
    )
    .await
    {
        Err(_) => Err(format!("lookup timed out after {:?}", CAPTIVE_DNS_TIMEOUT)),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok(mut addresses)) => match addresses.next() {
            Some(_) => Ok(()),
            None => Err("lookup returned no addresses".to_string()),
        },
    }
}

/// Returns the status plus a human-readable detail for the log line.
async fn probe_captive_portal() -> (CaptiveProbeStatus, String) {
    if let Err(detail) = resolve_captive_probe_host().await {
        return (CaptiveProbeStatus::DnsFailed, detail);
    }
    let url = format!("http://{}/", CAPTIVE_PROBE_HOST);
    match build_no_redirect_client().get(url).send().await {
        Ok(response) => {
            let status = response.status();
            (classify_http_status(status), format!("http {}", status))
        }
        Err(e) => (CaptiveProbeStatus::Unreachable, error_chain(&e)),
    }
}

fn log_captive_status(status: CaptiveProbeStatus, detail: &str) {
    let previous = LAST_CAPTIVE_STATUS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .replace(status);
    if previous == Some(status) {
        log::debug!("[captive] {:?} unchanged ({})", status, detail);
    } else {
        log::info!("[captive] {:?} -> {:?} ({})", previous, status, detail);
    }
}

#[tauri::command]
pub async fn check_captive_portal_status() -> i8 {
    let (status, detail) = probe_captive_portal().await;
    log_captive_status(status, &detail);
    status as i8
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
pub async fn ping_google(app: tauri::AppHandle) -> bool {
    let proxy = format!(
        "http://{}:{}",
        "127.0.0.1",
        crate::core::mixed_proxy_port(&app)
    );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_private_ip_basic() {
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("192.168.1.1"));
        assert!(!is_private_ip("8.8.8.8"));
    }

    #[test]
    fn captive_http_200_is_online() {
        assert_eq!(
            classify_http_status(StatusCode::OK),
            CaptiveProbeStatus::Online
        );
    }

    #[test]
    fn captive_http_redirect_is_captive_portal() {
        assert_eq!(
            classify_http_status(StatusCode::FOUND),
            CaptiveProbeStatus::CaptivePortal
        );
    }

    #[test]
    fn captive_http_other_status_is_unreachable() {
        assert_eq!(
            classify_http_status(StatusCode::INTERNAL_SERVER_ERROR),
            CaptiveProbeStatus::Unreachable
        );
    }

    #[test]
    fn captive_status_wire_values_match_frontend_contract() {
        assert_eq!(CaptiveProbeStatus::DnsFailed as i8, -2);
        assert_eq!(CaptiveProbeStatus::Unreachable as i8, -1);
        assert_eq!(CaptiveProbeStatus::Online as i8, 0);
        assert_eq!(CaptiveProbeStatus::CaptivePortal as i8, 1);
    }

    #[derive(Debug)]
    struct SendError(std::io::Error);

    impl std::fmt::Display for SendError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("error sending request")
        }
    }

    impl std::error::Error for SendError {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    #[test]
    fn error_chain_joins_every_source() {
        let error = SendError(std::io::Error::other("connection refused"));
        assert_eq!(
            error_chain(&error),
            "error sending request: connection refused"
        );
    }
}
