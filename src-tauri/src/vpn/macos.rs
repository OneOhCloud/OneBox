use crate::vpn::helper::extract_tun_gateway_from_config;
use crate::vpn::VpnProxy;
use crate::vpn::EVENT_TAURI_LOG;
use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
pub const TUN_INTERFACE_NAME: &str = "utun233";

// 默认绕过列表
pub static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

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
        port: config.port,
        bypass: config.bypass,
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy set to {}:{}", config.host, config.port);
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()> {
    // 清理系统代理设置
    // 使用 ok() 忽略 emit 错误，避免关机/退出时 event system 已拆除导致 panic
    app.emit(EVENT_TAURI_LOG, (0, "Start unset system proxy"))
        .ok();

    let mut sysproxy = match Sysproxy::get_system_proxy() {
        Ok(proxy) => proxy,
        Err(e) => {
            let msg = format!("Sysproxy::get_system_proxy failed: {}", e);
            app.emit(EVENT_TAURI_LOG, (1, msg.clone())).ok();
            return Err(anyhow::anyhow!(msg));
        }
    };
    sysproxy.enable = false;
    if let Err(e) = sysproxy.set_system_proxy() {
        let msg = format!("Sysproxy::set_system_proxy failed: {}", e);
        app.emit(EVENT_TAURI_LOG, (1, msg.clone())).ok();
        return Err(anyhow::anyhow!(msg));
    }

    app.emit(EVENT_TAURI_LOG, (0, "System proxy unset successfully"))
        .ok();
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
    let store = app.get_store("settings.json")?;
    let enable_bypass_router_key = "enable_bypass_router_key";
    let enable_bypass_router: bool = store
        .get(enable_bypass_router_key)
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let command = format!(
        r#"ulimit -n 65535 && echo '{}' | sudo -S '{}' run -c '{}' --disable-color"#,
        password.escape_default(),
        sidecar_path.escape_default(),
        path.escape_default()
    );
    log::info!(
        "Enable tun mode with command: {}",
        command.replace(password.as_str(), "******")
    );

    // 如果启用了旁路由模式，则开启IP转发
    if enable_bypass_router {
        let command = format!(
            "echo '{}' | sudo -S sysctl -w net.inet.ip.forwarding=1",
            password
        );
        log::info!(
            "Enable IP forwarding with command : {}",
            command.replace(password.as_str(), "******")
        );
        let _ = Command::new("sh")
            .arg("-c")
            .arg(command)
            .output()
            .map_err(|e| e.to_string());
    }

    // ZH: TUN 启动前把系统 DNS 指向 TUN 网关，绕开 mDNSResponder 的 per-interface
    //     直发行为。失败不阻塞启动 —— 代理连接仍能工作，只是 OS 级 DNS 查询会
    //     继续被污染，表现等同于未修复的旧行为。
    // EN: Override system DNS to the TUN gateway before spawn. Failures are
    //     non-fatal — the proxy still starts; OS-level DNS queries would just
    //     keep leaking as before the fix.
    if let Err(e) = apply_system_dns_override(&password, &path) {
        log::warn!("[dns] apply_system_dns_override failed: {}", e);
    }

    Some(app.shell().command("sh").args(vec!["-c", &command]))
}

/// 停止TUN模式下的进程，并清理 `utun233` 接口的路由。
///
/// 配置写入时固定 `interface_name = "utun233"`，停止后枚举该接口的路由并逐条删除，
/// 再 down 掉接口，让 macOS configd 从物理网卡重建默认路由。
pub fn stop_tun_process(password: &str) -> Result<(), String> {
    // ZH: 先把系统 DNS 恢复原值。即使后面杀进程 / 清路由的步骤失败，用户的
    //     网络 DNS 也不会被留在 TUN 网关状态。
    // EN: Restore original system DNS first so that even if later cleanup
    //     steps fail, the user's system DNS isn't stuck pointing at the TUN
    //     gateway.
    if let Err(e) = restore_system_dns(password) {
        log::warn!("[dns] restore_system_dns failed: {}", e);
    }

    let command = format!("echo '{}' | sudo -S pkill -15 -f sing-box", password);
    log::info!(
        "Stop tun mode with command : {}",
        command.replace(password, "******")
    );
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(500));

    // 关闭IP转发
    let command = format!(
        "echo '{}' | sudo -S sysctl -w net.inet.ip.forwarding=0",
        password
    );
    log::info!(
        "Disable IP forwarding with command : {}",
        command.replace(password, "******")
    );
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;

    let command = format!(
        "echo '{}' | sudo -S sh -c '\
            netstat -rn -f inet 2>/dev/null \
                | awk \"NR>4 && \\$NF==\\\"{iface}\\\"{{print \\$1}}\" \
                | while read dest; do route -q delete \"$dest\" 2>/dev/null; done; \
            netstat -rn -f inet6 2>/dev/null \
                | awk \"NR>4 && \\$NF==\\\"{iface}\\\"{{print \\$1}}\" \
                | while read dest; do route -q delete -inet6 \"$dest\" 2>/dev/null; done; \
            ifconfig {iface} down 2>/dev/null; \
            true'",
        password,
        iface = TUN_INTERFACE_NAME
    );
    log::info!("Removing routes for {} interface", TUN_INTERFACE_NAME);
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;

    flush_dns_cache(password);
    Ok(())
}

// ========== macOS 系统 DNS 接管 ==========
//
// ZH: macOS 的 `mDNSResponder` 不走路由表决定 DNS 查询的出接口，而是根据
//     `scutil --dns` 里每个网络服务绑定的 nameserver 直接从物理网卡发 UDP/53。
//     这使得 sing-box TUN 的 `hijack-dns` 规则触不到 OS 级查询，导致 curl/host 等
//     查询被 GFW 明文注入污染。
//     解决办法：TUN 启动时把系统 DNS 指向 TUN 网关 `172.19.0.1`，强制查询包进入
//     TUN 被 hijack-dns 捕获；TUN 停止时恢复原值。
// EN: macOS `mDNSResponder` does NOT use the routing table to decide which
//     interface to send DNS queries on. It uses the per-service nameserver
//     recorded in `scutil --dns` and sends UDP/53 directly via the physical NIC,
//     bypassing the TUN interface. As a result sing-box `hijack-dns` never sees
//     OS-level DNS queries, leaving them to be poisoned by GFW plaintext DNS
//     injection. Fix: point system DNS at the TUN gateway on TUN start, so every
//     DNS packet must traverse TUN and hit `hijack-dns`; restore on TUN stop.

/// ZH: 通过默认路由的出接口倒推 networksetup 的服务名（Wi-Fi / Ethernet 等）。
/// EN: Map the default route's outgoing interface to its networksetup service name.
fn detect_active_network_service() -> Result<String, String> {
    let out = Command::new("route")
        .args(["-n", "get", "default"])
        .output()
        .map_err(|e| format!("route get default failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let iface = stdout
        .lines()
        .find_map(|l| l.trim().strip_prefix("interface:").map(|s| s.trim().to_string()))
        .ok_or_else(|| "no default interface".to_string())?;
    log::info!("[dns] default interface: {}", iface);

    let out = Command::new("networksetup")
        .arg("-listallhardwareports")
        .output()
        .map_err(|e| format!("networksetup -listallhardwareports failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    let mut current_port: Option<String> = None;
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Hardware Port:") {
            current_port = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("Device:") {
            if rest.trim() == iface {
                if let Some(svc) = current_port.take() {
                    log::info!("[dns] active service: {}", svc);
                    return Ok(svc);
                }
            }
        }
    }
    Err(format!("could not map interface {} to a network service", iface))
}

/// ZH: 刷新 macOS DNS 缓存并重启 mDNSResponder。写入 DNS 改动后必须做，否则
///     新配置要过几秒才生效。
fn flush_dns_cache(password: &str) {
    let cmd = format!(
        "echo '{}' | sudo -S sh -c 'dscacheutil -flushcache; killall -HUP mDNSResponder' 2>/dev/null",
        password.escape_default()
    );
    let _ = Command::new("sh").arg("-c").arg(cmd).output();
}

/// ZH: 调用 networksetup 把指定服务的 DNS 设为给定 spec（`empty` 或具体 IP）。
/// EN: Thin wrapper around `networksetup -setdnsservers <service> <spec>`, where
///     `spec` is either the literal `empty` (revert to DHCP-provided) or a
///     space-separated IP list.
fn setdnsservers(password: &str, service: &str, spec: &str) -> Result<(), String> {
    let cmd = format!(
        "echo '{}' | sudo -S networksetup -setdnsservers '{}' {}",
        password.escape_default(),
        service.replace('\'', "'\\''"),
        spec
    );
    let out = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| format!("networksetup -setdnsservers failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        log::warn!("[dns] setdnsservers non-zero exit: {}", stderr);
    }
    Ok(())
}

/// ZH: 列出 macOS 所有网络服务（`networksetup -listallnetworkservices`
///     的输出，去掉第一行标题和被星号标记的禁用服务）。
/// EN: All macOS network services, minus the title line and any disabled
///     services (prefixed with `*` in networksetup's output).
fn list_all_network_services() -> Result<Vec<String>, String> {
    let out = Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()
        .map_err(|e| format!("networksetup -listallnetworkservices failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout
        .lines()
        .skip(1) // first line is "An asterisk (*) denotes that a network service is disabled."
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('*'))
        .map(|l| l.to_string())
        .collect())
}

/// ZH: 把系统 DNS 指向 TUN 网关。检测当前活动服务，一条 networksetup 命令搞定，
///     不做任何快照、不落地文件。
/// EN: Point system DNS at the TUN gateway. Detect the currently active network
///     service, apply in a single `networksetup` call. No snapshot, no state
///     file — restore is handled by the system's own `empty` semantics.
pub fn apply_system_dns_override(password: &str, config_path: &str) -> Result<(), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let service = detect_active_network_service()?;
    log::info!("[dns] override → {} for [{}]", gateway, service);
    setdnsservers(password, &service, &gateway)?;
    flush_dns_cache(password);
    Ok(())
}

/// ZH: 恢复系统 DNS。枚举所有网络服务，逐个 `setdnsservers <svc> empty`
///     让 macOS 回到 DHCP 下发的默认 DNS。不读文件、不查历史，完全幂等 ——
///     即使在 TUN 仍然在位时调用（stop 流程里 DNS 恢复早于 kill sing-box），
///     由于不依赖路由表探测，依然正确。
/// EN: Restore system DNS by iterating every network service and resetting
///     each to `empty` (DHCP default). Stateless, idempotent, works even while
///     TUN is still up (the normal stop flow restores DNS *before* killing
///     sing-box) because it doesn't rely on route-table detection.
pub fn restore_system_dns(password: &str) -> Result<(), String> {
    let services = list_all_network_services()?;
    log::info!("[dns] restore: resetting {} services → empty (DHCP)", services.len());
    for svc in &services {
        if let Err(e) = setdnsservers(password, svc, "empty") {
            log::warn!("[dns] failed to reset [{}]: {}", svc, e);
        }
    }
    flush_dns_cache(password);
    Ok(())
}

/// macOS平台的VPN代理实现
pub struct MacOSVpnProxy;

impl VpnProxy for MacOSVpnProxy {
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
