pub mod helper;
pub(crate) mod watchdog;

use self::helper as macos_helper;
use crate::engine::helper::extract_tun_gateway_from_config;
use crate::engine::EngineManager;
use crate::engine::EVENT_TAURI_LOG;
use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;
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

// ============================================================================
// Helper-backed TUN lifecycle
// ============================================================================

/// Ensure the privileged helper is installed (auto-install if needed).
/// Blocks the calling thread while the SMJobBless authorization prompt is
/// shown; callers must invoke from `spawn_blocking` / background.
pub fn ensure_helper_installed() -> Result<(), String> {
    match macos_helper::api::ping() {
        Ok(_) => Ok(()),
        Err(_) => {
            log::info!("[helper] not responding, triggering SMJobBless install...");
            macos_helper::api::install()
        }
    }
}

/// Start sing-box in TUN mode via the privileged helper. Called from
/// core.rs's macOS TUN branch instead of the old `create_privileged_command`.
///
/// Steps:
///   1. Enable IP forwarding if bypass-router mode is on.
///   2. Override system DNS to the TUN gateway (non-fatal on failure).
///   3. Ask the helper to posix_spawn sing-box as root.
///
/// Returns the helper-tracked pid on success.
pub fn start_tun_via_helper(app: &AppHandle, config_path: &str) -> Result<i32, String> {
    let enable_bypass_router: bool = app
        .get_store("settings.json")
        .and_then(|s| s.get("enable_bypass_router_key"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if enable_bypass_router {
        if let Err(e) = macos_helper::api::set_ip_forwarding(true) {
            log::warn!("[helper] set_ip_forwarding(true) failed: {}", e);
        }
    }

    // DNS override — non-fatal, mirrors the old create_privileged_command behavior.
    if let Err(e) = apply_system_dns_override(config_path) {
        log::warn!("[dns] apply_system_dns_override failed: {}", e);
    }

    let pid = macos_helper::api::start_sing_box(config_path)?;
    log::info!("[helper] sing-box started, pid={}", pid);
    Ok(pid)
}

/// Stop TUN mode: restore DNS, kill sing-box, disable IP forwarding, clean
/// routes, flush DNS cache. All operations go through the privileged helper.
///
/// Restore DNS runs first (before kill) so the user's network isn't left
/// pointing at an unreachable TUN gateway if the kill step fails.
pub fn stop_tun_process() -> Result<(), String> {
    if let Err(e) = restore_system_dns() {
        log::warn!("[dns] restore_system_dns failed: {}", e);
    }

    macos_helper::api::stop_sing_box()?;
    log::info!("[helper] SIGTERM sent to sing-box");

    std::thread::sleep(std::time::Duration::from_millis(500));

    if let Err(e) = macos_helper::api::set_ip_forwarding(false) {
        log::warn!("[helper] set_ip_forwarding(false) failed: {}", e);
    }

    if let Err(e) = macos_helper::api::remove_tun_routes(TUN_INTERFACE_NAME) {
        log::warn!("[helper] remove_tun_routes({}) failed: {}", TUN_INTERFACE_NAME, e);
    }

    macos_helper::api::flush_dns_cache().ok();
    Ok(())
}

// ============================================================================
// macOS 系统 DNS 接管 (passwordless, helper-backed)
// ============================================================================
//
// See the CLAUDE.md "System DNS Override Flow" section for the full design
// rationale. The only change in Phase 2b.2 is that setdnsservers / flushDnsCache
// now go through the XPC helper instead of `echo | sudo -S`.

/// Map the default route's outgoing interface to its networksetup service name.
/// Does NOT require root — route(1) and networksetup(1) are readable by any user.
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

/// All macOS network services, minus the title line and any disabled services
/// (prefixed with `*` in networksetup's output). Does NOT require root.
fn list_all_network_services() -> Result<Vec<String>, String> {
    let out = Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()
        .map_err(|e| format!("networksetup -listallnetworkservices failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout
        .lines()
        .skip(1)
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('*'))
        .map(|l| l.to_string())
        .collect())
}

/// Point system DNS at the TUN gateway. Detect the currently active network
/// service, apply via the privileged helper, flush cache.
pub fn apply_system_dns_override(config_path: &str) -> Result<(), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let service = detect_active_network_service()?;
    log::info!("[dns] override → {} for [{}]", gateway, service);
    macos_helper::api::set_dns_servers(&service, &gateway)?;
    macos_helper::api::flush_dns_cache().ok();
    Ok(())
}

/// Restore system DNS by iterating every network service and resetting each
/// to `empty` (DHCP default). Stateless, idempotent, works even while TUN
/// is still up.
pub fn restore_system_dns() -> Result<(), String> {
    let services = list_all_network_services()?;
    log::info!(
        "[dns] restore: resetting {} services → empty (DHCP)",
        services.len()
    );
    for svc in &services {
        if let Err(e) = macos_helper::api::set_dns_servers(svc, "empty") {
            log::warn!("[dns] failed to reset [{}]: {}", svc, e);
        }
    }
    macos_helper::api::flush_dns_cache().ok();
    Ok(())
}

// ============================================================================
// EngineManager trait impl.
//
// core.rs bypasses create_privileged_command entirely on macOS (goes through
// start_tun_via_helper instead). The trait methods are still required by the
// compiler; they delegate or no-op.
// ============================================================================

pub struct MacOSEngine;

impl EngineManager for MacOSEngine {
    async fn start(
        app: &AppHandle,
        mode: crate::core::ProxyMode,
        config_path: String,
    ) -> Result<(), String> {
        use std::sync::Arc;
        use tauri_plugin_shell::ShellExt;

        match mode {
            crate::core::ProxyMode::SystemProxy => {
                // User-mode sing-box sidecar — plain tauri spawn, no helper.
                let cmd = app
                    .shell()
                    .sidecar("sing-box")
                    .map_err(|e| format!("sidecar lookup failed: {}", e))?
                    .args(["run", "-c", &config_path, "--disable-color"]);
                let (rx, child) = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
                crate::core::monitor::spawn_process_monitor(
                    app.clone(),
                    rx,
                    Arc::new(mode.clone()),
                );
                {
                    let mut mgr = crate::core::ProcessManager::acquire();
                    mgr.mode = Some(Arc::new(mode));
                    mgr.config_path = Some(Arc::new(config_path));
                    mgr.child = Some(child);
                    mgr.is_stopping = false;
                }
                set_proxy(app).await.map_err(|e| e.to_string())?;
            }
            crate::core::ProxyMode::TunProxy => {
                // Root-mode sing-box is owned by the privileged XPC helper —
                // we ask the helper to install itself if needed, then ask it
                // to spawn sing-box, and subscribe to its exit notifications
                // so the process monitor fires on crash.
                Self::ensure_installed(app).await?;
                let app_c = app.clone();
                let path_c = config_path.clone();
                tokio::task::spawn_blocking(move || start_tun_via_helper(&app_c, &path_c))
                    .await
                    .map_err(|e| format!("start_tun join error: {}", e))?
                    .map_err(|e| format!("start_tun_via_helper failed: {}", e))?;

                // Bridge the XPC helper's sing-box exit event to the same
                // cleanup path any other mode goes through.
                let mut exit_rx = macos_helper::subscribe_sing_box_exits();
                let exit_app = app.clone();
                let mode_arc = Arc::new(crate::core::ProxyMode::TunProxy);
                let exit_mode = Arc::clone(&mode_arc);
                tokio::spawn(async move {
                    if let Some(exit) = exit_rx.recv().await {
                        log::info!(
                            "[helper-bridge] sing-box exit event pid={} code={}",
                            exit.pid,
                            exit.exit_code
                        );
                        let payload = tauri_plugin_shell::process::TerminatedPayload {
                            code: Some(exit.exit_code),
                            signal: None,
                        };
                        crate::core::monitor::handle_process_termination(
                            &exit_app,
                            &exit_mode,
                            payload,
                        )
                        .await;
                    }
                });

                let config_path_arc = Arc::new(config_path);
                {
                    let mut mgr = crate::core::ProcessManager::acquire();
                    mgr.mode = Some(Arc::clone(&mode_arc));
                    mgr.config_path = Some(Arc::clone(&config_path_arc));
                    mgr.child = None; // managed by helper
                    mgr.is_stopping = false;
                }

                // Optional bypass-router watchdog: restart sing-box every 4h
                // so macOS's auto_detect_interface can pick up routing table
                // changes that accumulate without a clean refresh. All
                // state (abort handle, restart-in-progress flag) lives
                // inside watchdog.rs, not in ProcessManager.
                let bypass_router_enabled = app
                    .get_store("settings.json")
                    .and_then(|store| store.get("enable_bypass_router_key"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if bypass_router_enabled {
                    watchdog::spawn(app.clone(), Arc::clone(&config_path_arc));
                }

                // TUN mode doesn't use the system HTTP proxy — clear any stale
                // one left over from a previous SystemProxy session.
                let _ = unset_proxy(app).await;
            }
        }
        Ok(())
    }

    async fn stop(app: &AppHandle) -> Result<(), String> {
        let (mode, child) = {
            let mut mgr = crate::core::ProcessManager::acquire();
            mgr.is_stopping = true;
            (mgr.mode.clone(), mgr.child.take())
        };
        let Some(mode) = mode else {
            return Ok(());
        };
        match mode.as_ref() {
            crate::core::ProxyMode::SystemProxy => {
                // Best-effort proxy teardown first so apps don't keep pointing
                // at a dying sing-box socket.
                let _ = unset_proxy(app).await;
                if let Some(child) = child {
                    use libc::{kill, SIGTERM};
                    let pid = child.pid();
                    if unsafe { kill(pid as i32, SIGTERM) } != 0 {
                        log::error!(
                            "[stop] Failed to send SIGTERM to PID {}: {}",
                            pid,
                            std::io::Error::last_os_error()
                        );
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            crate::core::ProxyMode::TunProxy => {
                stop_tun_process().map_err(|e| {
                    log::error!("Failed to stop TUN process: {}", e);
                    e
                })?;
            }
        }
        Ok(())
    }

    fn on_network_up(_app: &AppHandle) {
        // Re-apply the TUN gateway DNS override on the new active service.
        // Called from the onebox_lifecycle NetworkUp handler; reads the
        // current config from ProcessManager since the trait deliberately
        // does not expose it.
        let config_path = {
            let manager = crate::core::ProcessManager::acquire();
            match manager.config_path.as_ref() {
                Some(p) => p.as_str().to_string(),
                None => return, // engine not running; nothing to re-apply
            }
        };
        if let Err(e) = apply_system_dns_override(&config_path) {
            log::warn!("[dns] NetworkUp re-apply failed: {}", e);
        }
    }

    fn on_process_terminated(_app: &AppHandle, _was_user_stop: bool) {
        // Cancel the bypass-router watchdog eagerly — its own in-loop mode
        // check would eventually notice TUN is gone, but only after the
        // next 4h sleep, which is too slow.
        watchdog::cancel();
        log::info!("[dns] TUN process terminated — resetting all services to DHCP");
        if let Err(e) = restore_system_dns() {
            log::warn!("[dns] fallback restore_system_dns failed: {}", e);
        }
    }

    async fn ensure_installed(_app: &AppHandle) -> Result<(), String> {
        // SMJobBless requires a signed, notarized bundle with
        // SMPrivilegedExecutables set — see src-tauri/helper/README.md.
        // Ping first so we don't trigger the OS authorization prompt on
        // every call once the helper is already installed and reachable.
        tokio::task::spawn_blocking(ensure_helper_installed)
            .await
            .map_err(|e| format!("ensure_installed join error: {}", e))?
    }

    async fn probe(_app: &AppHandle) -> Result<String, String> {
        // XPC round-trip to the privileged helper. Fails if the helper
        // wasn't installed, or if code-signing caller-validation rejects
        // this process (e.g. `tauri dev` against a production helper).
        tokio::task::spawn_blocking(macos_helper::api::ping)
            .await
            .map_err(|e| format!("helper_ping join error: {}", e))?
    }

    async fn restart(_app: &AppHandle) -> Result<(), String> {
        // Read the current mode from shared state. TUN mode means sing-box
        // runs as root under the XPC helper — ask the helper to SIGHUP it,
        // then flush the OS resolver cache. SystemProxy mode means sing-box
        // runs as the current user so `pkill -HUP` is enough, and DNS isn't
        // overridden so no cache flush is needed.
        let is_tun = {
            let manager = crate::core::ProcessManager::acquire();
            matches!(
                manager.mode.as_ref().map(|m| m.as_ref()),
                Some(crate::core::ProxyMode::TunProxy)
            )
        };
        if is_tun {
            tokio::task::spawn_blocking(macos_helper::api::reload_sing_box)
                .await
                .map_err(|e| format!("reload join error: {}", e))?
                .map_err(|e| format!("helper reload_sing_box failed: {}", e))?;
            log::info!("[reload] SIGHUP sent via helper");

            // Clear mDNSResponder + dscacheutil. FakeIP responses carry a 600s
            // TTL, so without this the OS keeps returning stale mappings for
            // up to 10 minutes after the config switch.
            match tokio::task::spawn_blocking(macos_helper::api::flush_dns_cache).await {
                Ok(Ok(())) => log::info!("[reload] flushed DNS cache"),
                Ok(Err(e)) => log::warn!("[reload] flush_dns_cache failed: {}", e),
                Err(e) => log::warn!("[reload] flush_dns_cache join error: {}", e),
            }
        } else {
            let output = Command::new("pkill")
                .args(["-HUP", "sing-box"])
                .output()
                .map_err(|e| format!("Failed to send SIGHUP: {}", e))?;
            if !output.status.success() {
                return Err(format!(
                    "pkill -HUP non-zero: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            log::info!("[reload] SIGHUP sent via pkill");
        }
        Ok(())
    }
}
