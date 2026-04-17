pub mod helper;
pub(crate) mod watchdog;

use self::helper as macos_helper;
use crate::engine::helper::extract_tun_gateway_from_config;
use crate::engine::sysproxy::{clear_system_proxy, set_system_proxy};
use crate::engine::EngineManager;
use std::process::Command;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
pub const TUN_INTERFACE_NAME: &str = "utun233";

// ----------------------------------------------------------------------------
// DNS capture stash
//
// Every network service we override gets its pre-override DNS recorded here.
// `apply_system_dns_override` appends on first touch; it never overwrites an
// existing entry, so a second apply on the same service (e.g. NetworkUp
// re-trigger after we already wrote the TUN gateway) doesn't clobber the real
// original with our own gateway IP. On stop/crash the stash is drained and
// each captured entry is written back.
//
// Value format: `"empty"` if the service had no DNS set (DHCP default), or
// a space-separated list of IPv4/IPv6 addresses.
// ----------------------------------------------------------------------------
static DNS_CAPTURED: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

fn capture_if_new(service: &str, original: String) {
    let mut stash = DNS_CAPTURED.lock().unwrap_or_else(|e| e.into_inner());
    if !stash.iter().any(|(s, _)| s == service) {
        stash.push((service.to_string(), original));
    }
}

fn take_all_captured() -> Vec<(String, String)> {
    let mut stash = DNS_CAPTURED.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *stash)
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
/// Split into two restore phases so verification probes don't leak through
/// the still-live TUN:
///   1. **pre-kill** — synchronously write captured originals back. This must
///      run before sing-box is killed so the physical NIC's default route
///      inherits a working DNS the instant TUN tears down.
///   2. **post-kill** — probe each restored DNS for reachability; if all fail
///      swap in the best public resolver. Probing earlier is useless: while
///      sing-box is alive, every UDP/53 packet from this process gets routed
///      through TUN → through the proxy → every server looks reachable and
///      the fallback never fires.
pub async fn stop_tun_process() -> Result<(), String> {
    let captured = take_all_captured();
    let applied = apply_captured_originals_sync(&captured);

    macos_helper::api::stop_sing_box()?;
    log::info!("[helper] SIGTERM sent to sing-box");

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    if let Err(e) = macos_helper::api::set_ip_forwarding(false) {
        log::warn!("[helper] set_ip_forwarding(false) failed: {}", e);
    }

    if let Err(e) = macos_helper::api::remove_tun_routes(TUN_INTERFACE_NAME) {
        log::warn!("[helper] remove_tun_routes({}) failed: {}", TUN_INTERFACE_NAME, e);
    }

    verify_and_fallback(&applied).await;

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

/// Read the DNS servers currently configured on a network service.
/// Returns `"empty"` when no DNS is set (DHCP default), otherwise
/// space-separated IPs. Does NOT require root.
fn read_service_dns(service: &str) -> String {
    let out = match Command::new("networksetup")
        .args(["-getdnsservers", service])
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            log::warn!("[dns] -getdnsservers [{}] failed: {}", service, e);
            return "empty".to_string();
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let ips: Vec<&str> = stdout
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && l.parse::<std::net::IpAddr>().is_ok())
        .collect();
    if ips.is_empty() {
        "empty".to_string()
    } else {
        ips.join(" ")
    }
}

/// Point system DNS at the TUN gateway. Detect the currently active network
/// service, capture its pre-override DNS (first touch only), apply via the
/// privileged helper, flush cache.
pub fn apply_system_dns_override(config_path: &str) -> Result<(), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let service = detect_active_network_service()?;

    // Capture the service's current DNS before we overwrite it. If we've
    // already touched this service (re-apply after NetworkUp), skip so the
    // stash keeps the true original instead of our own gateway IP.
    let original = read_service_dns(&service);
    capture_if_new(&service, original.clone());
    log::info!(
        "[dns] override → {} for [{}] (captured original: {})",
        gateway,
        service,
        original
    );
    macos_helper::api::set_dns_servers(&service, &gateway)?;
    macos_helper::api::flush_dns_cache().ok();
    Ok(())
}

/// Write captured originals back, synchronously. Returns the subset that
/// the helper accepted — those are the entries eligible for the post-kill
/// verify pass.
///
/// Must run **before** sing-box is killed so the physical NIC default
/// route never briefly inherits the stale `172.19.0.1` gateway IP that
/// becomes unreachable the moment TUN tears down.
fn apply_captured_originals_sync(captured: &[(String, String)]) -> Vec<(String, String)> {
    if captured.is_empty() {
        log::info!("[dns] no captured services; nothing to restore");
        return Vec::new();
    }
    log::info!("[dns] restore (phase 1, pre-kill): {} service(s)", captured.len());
    let mut applied = Vec::with_capacity(captured.len());
    for (service, original) in captured {
        log::info!("[dns] restore [{}] → {}", service, original);
        if let Err(e) = macos_helper::api::set_dns_servers(service, original) {
            log::warn!("[dns] restore [{}] failed: {}", service, e);
            continue;
        }
        applied.push((service.clone(), original.clone()));
    }
    macos_helper::api::flush_dns_cache().ok();
    applied
}

/// Probe each restored DNS server on UDP/53. If **none** of a service's
/// captured servers respond, swap it for `get_best_dns_server` so the user
/// isn't stranded on a stale IP (e.g. a Wi-Fi router that has since
/// disappeared). Must only run AFTER sing-box has exited and TUN has been
/// removed — otherwise every probe is routed through TUN → proxy and all
/// servers look reachable, producing bogus "everything's fine" results.
async fn verify_and_fallback(applied: &[(String, String)]) {
    if applied.is_empty() {
        return;
    }
    for (service, original) in applied {
        if original == "empty" {
            // Back to DHCP defaults — there's no single IP to probe; trust
            // whatever DHCP hands out.
            continue;
        }
        let mut any_alive = false;
        for ip in original.split_whitespace() {
            if crate::commands::dns::probe_dns_reachable(ip).await {
                any_alive = true;
                break;
            }
        }
        if any_alive {
            continue;
        }
        log::warn!(
            "[dns] restored [{}] DNS ({}) unreachable — falling back to best public DNS",
            service,
            original
        );
        if let Some(best) = crate::commands::dns::get_best_dns_server().await {
            if let Err(e) = macos_helper::api::set_dns_servers(service, &best) {
                log::warn!(
                    "[dns] fallback set_dns_servers [{}] → {}: {}",
                    service,
                    best,
                    e
                );
            } else {
                log::info!("[dns] [{}] fell back to {}", service, best);
            }
        }
    }
    macos_helper::api::flush_dns_cache().ok();
}

/// Crash-path restore (called from `on_process_terminated`). sing-box has
/// already exited by the time this runs, so we can do write + verify back
/// to back without the "probe leaks through TUN" hazard that forces the
/// user-stop path in `stop_tun_process` to split the phases.
///
/// Services we never touched are left alone — this is NOT a scorched-earth
/// reset. Any manual DNS the user configured on an untouched interface
/// (e.g. Ethernet while TUN ran over Wi-Fi) is preserved.
pub async fn restore_system_dns() -> Result<(), String> {
    let captured = take_all_captured();
    let applied = apply_captured_originals_sync(&captured);
    verify_and_fallback(&applied).await;
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
        mode: crate::engine::ProxyMode,
        config_path: String,
    ) -> Result<(), String> {
        use std::sync::Arc;
        use tauri_plugin_shell::ShellExt;

        match mode {
            crate::engine::ProxyMode::SystemProxy => {
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
                set_system_proxy(app).await.map_err(|e| e.to_string())?;
            }
            crate::engine::ProxyMode::TunProxy => {
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
                let mode_arc = Arc::new(crate::engine::ProxyMode::TunProxy);
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
                let _ = clear_system_proxy(app).await;
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
            crate::engine::ProxyMode::SystemProxy => {
                // Best-effort proxy teardown first so apps don't keep pointing
                // at a dying sing-box socket.
                let _ = clear_system_proxy(app).await;
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
            crate::engine::ProxyMode::TunProxy => {
                stop_tun_process().await.map_err(|e| {
                    log::error!("Failed to stop TUN process: {}", e);
                    e
                })?;
            }
        }
        Ok(())
    }

    fn on_network_up(_app: &AppHandle) {
        // Re-apply the TUN gateway DNS override on the new active service.
        // Called unconditionally from the lifecycle handler; gate on
        // "engine running in TUN mode" so SystemProxy sessions and idle
        // states don't try to rewrite DNS.
        let config_path = {
            let manager = crate::core::ProcessManager::acquire();
            match (manager.mode.as_ref(), manager.config_path.as_ref()) {
                (Some(m), Some(p)) if matches!(**m, crate::engine::ProxyMode::TunProxy) => {
                    p.as_str().to_string()
                }
                _ => return,
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
        log::info!("[dns] TUN process terminated — restoring captured originals");
        // Async restore runs fire-and-forget. take_all_captured drains the
        // stash so if the user-stop path already consumed it, this lands as
        // a harmless no-op (captured list empty → early return).
        tauri::async_runtime::spawn(async {
            if let Err(e) = restore_system_dns().await {
                log::warn!("[dns] fallback restore_system_dns failed: {}", e);
            }
        });
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
                Some(crate::engine::ProxyMode::TunProxy)
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
