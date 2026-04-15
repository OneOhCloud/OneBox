use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;

use crate::vpn::helper::extract_tun_gateway_from_config;
use crate::vpn::VpnProxy;

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
    // 清理系统代理设置
    let mut sysproxy = Sysproxy::get_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    sysproxy.enable = false;

    sysproxy
        .set_system_proxy()
        .map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy unset");
    Ok(())
}

/// 特权模式下启动进程
pub fn create_privileged_command(
    app: &AppHandle,
    sidecar_path: String,
    path: String,
    password: String,
) -> Option<TauriCommand> {
    // ZH: TUN 启动前把系统 DNS 指向 TUN 网关，防止 systemd-resolved 经
    //     `SO_BINDTODEVICE` 绕开 fwmark 路由直接从物理网卡发 DNS。
    //     失败不阻塞启动。
    // EN: Override system DNS before spawn so systemd-resolved cannot bypass
    //     fwmark-based routing via SO_BINDTODEVICE. Non-fatal on failure.
    if let Err(e) = apply_system_dns_override(&password, &path) {
        log::warn!("[dns] apply_system_dns_override failed: {}", e);
    }

    let command = format!(
        r#"echo '{}' | sudo -S '{}' run -c '{}' --disable-color"#,
        password.escape_default(),
        sidecar_path.escape_default(),
        path.escape_default()
    );
    log::debug!("Executing command: {}", command);
    Some(app.shell().command("sh").args(vec!["-c", &command]))
}

/// 停止TUN模式下的进程
pub fn stop_tun_process(password: &str) -> Result<(), String> {
    // ZH: 先恢复系统 DNS，再杀 sing-box，保证即使后面失败用户网络也不至于卡住。
    if let Err(e) = restore_system_dns(password) {
        log::warn!("[dns] restore_system_dns failed: {}", e);
    }

    let command = format!("echo '{}' | sudo -S pkill -f sing-box", password);
    log::debug!("Executing command: {}", command);
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ========== Linux 系统 DNS 接管 (systemd-resolved) ==========
//
// ZH: Ubuntu 18.04+ 默认启用 systemd-resolved 作为 stub resolver (127.0.0.53)，
//     通过 per-link DNS 把上游查询发往配置的 nameserver。新版本 resolved 会用
//     `SO_BINDTODEVICE` 把查询 socket 绑到具体物理接口，绕开 sing-box TUN 的
//     fwmark 路由。解决方式：强制把活跃接口的 per-link DNS 改成 TUN 网关。
//     恢复走 `resolvectl revert`（systemd 原生的"回到默认"语义），不做快照。
// EN: Ubuntu uses systemd-resolved as a stub resolver. Recent versions may
//     bind the upstream socket to a physical interface, bypassing sing-box's
//     fwmark routing. Fix: force the active link's per-link DNS to the TUN
//     gateway. Restore is `resolvectl revert` on every link — systemd's own
//     "back to defaults" semantics; no snapshot, no backup file.

/// ZH: 检测默认路由出接口名，如 "wlp2s0" / "enp3s0"。
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

/// ZH: 枚举所有非 loopback 网络接口，用于 restore 阶段逐个 revert。
/// EN: All non-loopback network interfaces, iterated by restore.
fn list_all_ifaces() -> Result<Vec<String>, String> {
    let out = Command::new("sh")
        .arg("-c")
        .arg("ip -br link show 2>/dev/null | awk '{print $1}'")
        .output()
        .map_err(|e| format!("ip -br link show failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && *l != "lo")
        .map(|l| {
            // Strip any @parent suffix ("wlan0@NONE" → "wlan0").
            l.split('@').next().unwrap_or(l).to_string()
        })
        .collect())
}

/// ZH: 把活跃接口的 per-link DNS 指向 TUN 网关。不做快照，不落地文件。
/// EN: Point the active link's per-link DNS at the TUN gateway. No snapshot,
///     no state file — restore relies on `resolvectl revert` semantics.
pub fn apply_system_dns_override(password: &str, config_path: &str) -> Result<(), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let iface = detect_active_iface()?;

    let cmd = format!(
        "echo '{}' | sudo -S resolvectl dns '{}' {}",
        password.escape_default(),
        iface.replace('\'', "'\\''"),
        gateway
    );
    log::info!("[dns] resolvectl override → {} for [{}]", gateway, iface);
    let out = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| format!("resolvectl set failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        log::warn!("[dns] resolvectl non-zero exit: {}", stderr);
    }
    Ok(())
}

/// ZH: 恢复系统 DNS。枚举所有 link 逐个 `resolvectl revert`，让
///     systemd-resolved 把 per-link DNS 回退到 NetworkManager / netplan
///     的配置。对从未被我们 override 过的 link 执行也是幂等 no-op。
/// EN: Restore: iterate every link and run `resolvectl revert`, letting
///     systemd-resolved drop back to NetworkManager / netplan's configured
///     DNS. Idempotent on links we never touched.
pub fn restore_system_dns(password: &str) -> Result<(), String> {
    let ifaces = list_all_ifaces()?;
    log::info!("[dns] restore: reverting {} links to defaults", ifaces.len());
    for iface in &ifaces {
        let cmd = format!(
            "echo '{}' | sudo -S resolvectl revert '{}'",
            password.escape_default(),
            iface.replace('\'', "'\\''")
        );
        if let Err(e) = Command::new("sh").arg("-c").arg(cmd).output() {
            log::warn!("[dns] failed to revert [{}]: {}", iface, e);
        }
    }
    Ok(())
}

/// Linux平台的VPN代理实现
pub struct LinuxVpnProxy;

impl VpnProxy for LinuxVpnProxy {
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
        password: String,
    ) -> Option<TauriCommand> {
        create_privileged_command(app, sidecar_path, path, password)
    }

    fn stop_tun_process(password: &str) -> Result<(), String> {
        stop_tun_process(password)
    }
}
