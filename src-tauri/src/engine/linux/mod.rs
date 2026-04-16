use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;

use crate::engine::helper::extract_tun_gateway_from_config;
use crate::engine::EngineManager;

// 默认绕过列表
pub static DEFAULT_BYPASS: &str =
    "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";

/// 代理配置
#[derive(Clone)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    pub bypass: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 6789,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}

/// 设置系统代理
pub async fn set_proxy(_app: &AppHandle) -> anyhow::Result<()> {
    let config = ProxyConfig::default();
    let sys = Sysproxy {
        enable: true,
        host: config.host.clone(),
        port: config.port.clone(),
        bypass: config.bypass,
    };
    sys.set_system_proxy()?;
    log::info!("Proxy set to {}:{}", config.host, config.port);
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(_app: &AppHandle) -> anyhow::Result<()> {
    let mut sysproxy = Sysproxy::get_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    sysproxy.enable = false;
    sysproxy
        .set_system_proxy()
        .map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy unset");
    Ok(())
}

pub const HELPER_PATH: &str = "/usr/lib/OneBox/onebox-tun-helper";

/// Build the pkexec-wrapped command to start sing-box as root via the
/// privileged helper. DNS override + sing-box launch happen in a single
/// pkexec call (one auth prompt). The helper uses `exec` so pkexec stays
/// as parent and Tauri can monitor the process.
pub fn create_privileged_command(
    app: &AppHandle,
    sidecar_path: String,
    path: String,
    dns_override: Option<&(String, String)>,
) -> Option<TauriCommand> {
    let mut args = vec![HELPER_PATH.to_string(), "start-tun".to_string(), sidecar_path, path.clone()];

    if let Some((iface, _original)) = dns_override {
        let gateway = extract_tun_gateway_from_config(&path).unwrap_or_default();
        if !gateway.is_empty() {
            args.push(iface.clone());
            args.push(gateway);
        }
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    Some(app.shell().command("pkexec").args(args_ref))
}

/// Stop sing-box and restore DNS in a single pkexec call (one auth prompt).
pub fn stop_tun_and_restore_dns(
    dns_override: Option<&(String, String)>,
) -> Result<(), String> {
    let mut args = vec![HELPER_PATH, "stop-tun"];

    let iface_owned;
    let servers_owned;
    if let Some((iface, original_dns)) = dns_override {
        log::info!(
            "[dns] restore: setting [{}] DNS back to {}",
            iface,
            original_dns
        );
        iface_owned = iface.clone();
        servers_owned = original_dns.clone();
        args.push(&iface_owned);
        for server in servers_owned.split_whitespace() {
            args.push(server);
        }
    }

    let out = Command::new("pkexec")
        .args(&args)
        .output()
        .map_err(|e| format!("pkexec stop failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        log::warn!("[stop] pkexec non-zero exit: {}", stderr);
    }
    Ok(())
}

/// Legacy trait-compatible wrapper (unused on Linux, kept for trait signature).
pub fn stop_tun_process() -> Result<(), String> {
    stop_tun_and_restore_dns(None)
}

// ========== Linux 系统 DNS 接管 (systemd-resolved) ==========
//
// Ubuntu 18.04+ uses systemd-resolved as a stub resolver (127.0.0.53).
// Recent versions bind upstream sockets to physical interfaces via
// SO_BINDTODEVICE, bypassing sing-box's fwmark routing. Fix: force
// the active link's per-link DNS to the TUN gateway.
//
// Restore: re-apply the original DNS obtained from NetworkManager
// (nmcli) on the single interface we overrode. We do NOT touch other
// interfaces (e.g. tailscale0), and we do NOT use `resolvectl revert`
// which clears DNS entirely in "foreign" resolv.conf mode.

/// Detect the default-route egress interface (e.g. "ens33", "wlp2s0").
fn detect_active_iface() -> Result<String, String> {
    let out = Command::new("sh")
        .arg("-c")
        .arg("ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"dev\") print $(i+1)}' | head -1")
        .output()
        .map_err(|e| format!("ip route get failed: {}", e))?;
    let iface = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if iface.is_empty() {
        Err("no default interface".into())
    } else {
        Ok(iface)
    }
}

/// Capture the current DNS servers for an interface from NetworkManager.
/// Falls back to parsing `resolvectl status <iface>` if nmcli fails.
fn capture_original_dns(iface: &str) -> Result<String, String> {
    // Try nmcli first (most reliable on NM-managed systems).
    let out = Command::new("nmcli")
        .args(["-t", "-f", "IP4.DNS", "dev", "show", iface])
        .output()
        .map_err(|e| format!("nmcli failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // nmcli output looks like "IP4.DNS[1]:192.168.6.2\nIP4.DNS[2]:8.8.8.8"
    let servers: Vec<&str> = stdout
        .lines()
        .filter_map(|l| l.split(':').nth(1))
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if !servers.is_empty() {
        return Ok(servers.join(" "));
    }

    // Fallback: parse resolvectl status output.
    let out = Command::new("resolvectl")
        .args(["status", iface])
        .output()
        .map_err(|e| format!("resolvectl status failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("DNS Servers:") || line.starts_with("Current DNS Server:") {
            if let Some(servers) = line.split(':').nth(1) {
                let s = servers.trim();
                if !s.is_empty() {
                    return Ok(s.to_string());
                }
            }
        }
    }

    Err(format!("could not determine original DNS for {}", iface))
}

/// Capture the active interface and its current DNS servers WITHOUT applying
/// the override yet. The actual override is baked into the pkexec call in
/// `create_privileged_command` so only one auth prompt is needed.
pub fn prepare_dns_override(config_path: &str) -> Result<(String, String), String> {
    // Verify the config has a TUN gateway (early fail before prompting user).
    let _gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let iface = detect_active_iface()?;
    let original_dns = capture_original_dns(&iface)?;
    log::info!(
        "[dns] captured original DNS for [{}]: {}",
        iface,
        original_dns
    );
    Ok((iface, original_dns))
}

/// Override the active interface's DNS to point at the TUN gateway.
/// Returns `(iface, original_dns)` for later restoration.
/// Used by reapply_tun_dns_override_if_active (network change handler).
pub fn apply_system_dns_override(config_path: &str) -> Result<(String, String), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let iface = detect_active_iface()?;
    let original_dns = capture_original_dns(&iface)?;

    log::info!(
        "[dns] resolvectl override → {} for [{}] (original: {})",
        gateway,
        iface,
        original_dns
    );
    let out = Command::new("pkexec")
        .args([HELPER_PATH, "dns-override", &iface, &gateway])
        .output()
        .map_err(|e| format!("pkexec dns-override failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        log::warn!("[dns] dns-override non-zero exit: {}", stderr);
    }
    Ok((iface, original_dns))
}

/// Restore DNS on the single interface we overrode, using the original
/// servers captured at override time. Does NOT touch other interfaces.
pub fn restore_system_dns(iface: &str, original_dns: &str) -> Result<(), String> {
    log::info!(
        "[dns] restore: setting [{}] DNS back to {}",
        iface,
        original_dns
    );
    let mut args = vec![HELPER_PATH, "dns-restore", iface];
    let servers: Vec<&str> = original_dns.split_whitespace().collect();
    args.extend(servers);

    let out = Command::new("pkexec")
        .args(&args)
        .output()
        .map_err(|e| format!("pkexec dns-restore failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("[dns] restore failed: {}", stderr));
    }
    Ok(())
}

pub struct LinuxEngine;

impl EngineManager for LinuxEngine {
    async fn set_proxy(_app: &AppHandle) -> anyhow::Result<()> {
        set_proxy(_app).await
    }

    async fn unset_proxy(_app: &AppHandle) -> anyhow::Result<()> {
        unset_proxy(_app).await
    }

    fn create_privileged_command(
        app: &AppHandle,
        sidecar_path: String,
        path: String,
    ) -> Option<TauriCommand> {
        create_privileged_command(app, sidecar_path, path, None)
    }

    fn stop_tun_process() -> Result<(), String> {
        stop_tun_process()
    }

    fn reapply_dns_override(config_path: &str) -> Option<(String, String)> {
        match apply_system_dns_override(config_path) {
            Ok(info) => Some(info),
            Err(e) => {
                log::warn!("[dns] NetworkUp re-apply failed: {}", e);
                None
            }
        }
    }

    fn restore_dns_after_termination(
        _was_user_stop: bool,
        dns_info: Option<(String, String)>,
    ) {
        if let Some((iface, original_dns)) = dns_info {
            log::info!(
                "[dns] TUN process terminated — restoring [{}] DNS to {}",
                iface,
                original_dns
            );
            if let Err(e) = restore_system_dns(&iface, &original_dns) {
                log::warn!("[dns] fallback restore_system_dns failed: {}", e);
            }
        } else {
            log::warn!(
                "[dns] TUN terminated but no dns_override captured; DNS may need manual restore"
            );
        }
    }
}
