pub mod dns_watcher;
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
// Active-primary DNS override slot
//
// OneBox only cares about the currently active (primary) network service —
// non-primary services' DNS is irrelevant to the leak surface because the OS
// resolver binds to the primary. This slot holds at most one entry:
//
//   service   display name ("Wi-Fi", "Ethernet", ...)
//   captured  pre-override DNS ("empty" for DHCP default, or space-joined IPs).
//             Updated live by dns_watcher whenever an external party (user via
//             System Settings / networksetup, another VPN, MDM) rewrites DNS
//             on this service during TUN — so restore always uses the user's
//             most recent intent, not a frozen TUN-start snapshot.
//   gateway   the TUN gateway IP we're writing. Stored here so the watcher
//             can re-apply without re-reading the sing-box config.
//
// State transitions (driven by `apply_system_dns_override`):
//   None                                           — TUN inactive
//   None         → Some{svc_A, captured_A, gw}     — TUN start on primary A
//   Some{A,...}  → Some{svc_B, captured_B, gw}     — primary switched A → B;
//                                                    A gets its captured_A
//                                                    written back before B is
//                                                    captured.
//   Some{A,...}  → Some{A, captured', gw}          — external DNS write on A;
//                                                    captured' = new value,
//                                                    re-override to gw.
//   Some{A,...}  → None                            — TUN stop; A gets its
//                                                    captured_A written back.
// ----------------------------------------------------------------------------
#[derive(Clone, Debug)]
pub(crate) struct ActiveOverride {
    pub service: String,
    pub captured: String,
    pub gateway: String,
    /// True between `release_dns_on_network_down` writing `"empty"` and the
    /// next `apply_system_dns_override` that re-applies the gateway. While
    /// true, `reapply_on_active_primary` short-circuits so the
    /// SCDynamicStore watcher's echo of our own `"empty"` write isn't
    /// misclassified as an "external write" (which would revert Setup back
    /// to the gateway and defeat the release).
    pub released: bool,
}

static ACTIVE_OVERRIDE: Mutex<Option<ActiveOverride>> = Mutex::new(None);

pub(crate) fn active_override_snapshot() -> Option<ActiveOverride> {
    ACTIVE_OVERRIDE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn take_active_override() -> Option<ActiveOverride> {
    let mut slot = ACTIVE_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner());
    let taken = slot.take();
    if let Some(ref a) = taken {
        log::info!(
            "[dns] drain slot: service='{}' captured='{}'",
            a.service,
            a.captured
        );
    } else {
        log::info!("[dns] drain slot: empty");
    }
    taken
}

// ============================================================================
// Helper-backed TUN lifecycle
// ============================================================================

/// Ensure the privileged helper is installed (auto-install if needed).
/// Blocks the calling thread while the SMJobBless authorization prompt is
/// shown; callers must invoke from `spawn_blocking` / background.
///
/// Upgrade gate: compares the manually-maintained `CFBundleVersion`
/// strings embedded in the bundled vs. installed helper binaries'
/// `__TEXT,__info_plist` section. Mismatch triggers install(); match
/// short-circuits to the ping check. The `CFBundleVersion` value is the
/// ONLY upgrade signal — developers bump it by hand in
/// `src-tauri/helper/Info.plist` whenever helper source changes
/// (`Sources/main.m`, either plist). See the "Privileged helper version
/// bump (macOS)" section in CLAUDE.md for the invariant and rationale.
pub fn ensure_helper_installed() -> Result<(), String> {
    let ping_result = macos_helper::api::ping();
    if ping_result.is_err() {
        log::info!("[helper] not responding, triggering SMJobBless install...");
        return macos_helper::api::install();
    }

    let bundled = bundled_helper_path().and_then(|p| read_helper_cfbundle_version(&p));
    let installed = read_helper_cfbundle_version(std::path::Path::new(
        "/Library/PrivilegedHelperTools/cloud.oneoh.onebox.helper",
    ));

    match (bundled, installed) {
        (Some(b), Some(i)) if b != i => {
            log::info!(
                "[helper] CFBundleVersion bundled={} installed={}; upgrading via SMJobBless",
                b,
                i
            );
            macos_helper::api::install()
        }
        _ => Ok(()),
    }
}

/// Resolve the helper shipped inside this running app's bundle.
/// /Applications/OneBox.app/Contents/MacOS/one-box
///   → /Applications/OneBox.app/Contents/Library/LaunchServices/<label>
/// Returns None in dev/unbundled layouts so the caller falls back to
/// the ping branch rather than spuriously prompting for SMJobBless.
fn bundled_helper_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents = exe.parent()?.parent()?;
    let p = contents
        .join("Library")
        .join("LaunchServices")
        .join("cloud.oneoh.onebox.helper");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Extract the `CFBundleVersion` string from a Mach-O binary's
/// `__TEXT,__info_plist` section. The plist is embedded as ASCII XML,
/// so a byte scan for the exact `<key>CFBundleVersion</key>` marker
/// followed by the next `<string>…</string>` is sufficient — no Mach-O
/// header parsing needed. Returns None if the file is unreadable, the
/// marker is absent, or the value isn't valid UTF-8. Using the fully
/// tagged marker avoids any accidental substring match with other
/// plist keys (e.g. `CFBundleShortVersionString`).
fn read_helper_cfbundle_version(path: &std::path::Path) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    let key = b"<key>CFBundleVersion</key>";
    let key_pos = data.windows(key.len()).position(|w| w == key)?;
    let after_key = &data[key_pos + key.len()..];
    let open = b"<string>";
    let open_pos = after_key.windows(open.len()).position(|w| w == open)?;
    let value_start = open_pos + open.len();
    let close = b"</string>";
    let close_rel = after_key[value_start..]
        .windows(close.len())
        .position(|w| w == close)?;
    let bytes = &after_key[value_start..value_start + close_rel];
    std::str::from_utf8(bytes).ok().map(|s| s.to_string())
}

#[cfg(test)]
mod version_extract_tests {
    use super::read_helper_cfbundle_version;
    use std::io::Write;

    fn write_tmp(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(bytes).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn extracts_version_from_minimal_plist_bytes() {
        let body = b"<key>CFBundleVersion</key>\n<string>1.4.11</string>";
        let f = write_tmp(body);
        assert_eq!(
            read_helper_cfbundle_version(f.path()),
            Some("1.4.11".to_string())
        );
    }

    #[test]
    fn ignores_cfbundleshortversionstring_substring() {
        // ShortVersionString appears *before* CFBundleVersion; the
        // extractor must not latch onto its `<string>` block.
        let body = b"<key>CFBundleShortVersionString</key>\n<string>9.9.9</string>\n\
                    <key>CFBundleVersion</key>\n<string>42</string>";
        let f = write_tmp(body);
        assert_eq!(
            read_helper_cfbundle_version(f.path()),
            Some("42".to_string())
        );
    }

    #[test]
    fn returns_none_when_marker_absent() {
        let body = b"<plist><key>Something</key><string>else</string></plist>";
        let f = write_tmp(body);
        assert_eq!(read_helper_cfbundle_version(f.path()), None);
    }

    #[test]
    fn returns_none_when_file_missing() {
        let p = std::path::Path::new("/tmp/__onebox_does_not_exist__");
        assert_eq!(read_helper_cfbundle_version(p), None);
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

    // Start the SCDynamicStore watcher once per app lifetime. It's a no-op
    // when ACTIVE_OVERRIDE is None, so it's safe to leave running after TUN
    // stops. See `dns_watcher` for the callback contract.
    dns_watcher::ensure_started();

    // Resolve today's sing-box log path (runs 7-day prune + previous-day
    // compression as a side effect) and hand it to the helper so sing-box's
    // stdout/stderr land in the same sing-box-<date>.log file that
    // SystemProxy mode writes to. We intentionally hard-fail TUN start if
    // the path can't be resolved — this path is essentially infallible on
    // macOS (app_log_dir() + create_dir_all on a user-owned dir), and a
    // silent fallback to /dev/null would re-introduce exactly the "no
    // sing-box kernel log" bug this change is fixing.
    let log_path = crate::core::resolve_singbox_log_path(app)
        .ok_or_else(|| "failed to resolve sing-box log path".to_string())?;
    let log_path_str = log_path.to_string_lossy();

    let pid = macos_helper::api::start_sing_box(config_path, &log_path_str)?;
    log::info!("[helper] sing-box started, pid={} log={}", pid, log_path_str);
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
    log::info!("[dns] user-stop: beginning DNS restore sequence");
    let taken = take_active_override();
    let applied = apply_captured_originals_sync(taken.as_ref());

    log::info!("[helper] sending SIGTERM to sing-box");
    macos_helper::api::stop_sing_box()?;
    log::info!("[helper] SIGTERM sent to sing-box, waiting 500ms for TUN teardown");

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    if let Err(e) = macos_helper::api::set_ip_forwarding(false) {
        log::warn!("[helper] set_ip_forwarding(false) failed: {}", e);
    }

    if let Err(e) = macos_helper::api::remove_tun_routes(TUN_INTERFACE_NAME) {
        log::warn!("[helper] remove_tun_routes({}) failed: {}", TUN_INTERFACE_NAME, e);
    } else {
        log::info!("[helper] TUN routes removed on {}", TUN_INTERFACE_NAME);
    }

    verify_and_fallback(applied.as_ref()).await;

    macos_helper::api::flush_dns_cache().ok();
    log::info!("[dns] user-stop: restore sequence complete");
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
    log::debug!("[dns] default interface: {}", iface);

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
                    log::debug!("[dns] active service: {}", svc);
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

/// Point system DNS at the TUN gateway. The single entry point that drives
/// the ACTIVE_OVERRIDE state machine; safe to call repeatedly from TUN start,
/// the NetworkUp lifecycle event, and the dns_watcher callback.
///
/// Handles three transitions:
/// 1. slot None, no primary detected — no-op.
/// 2. slot None, or slot.service differs from the newly-detected primary —
///    restore the old service's captured value (if any), then capture the new
///    service's current DNS and override it.
/// 3. slot.service matches the new primary and current DNS != gateway —
///    update slot.captured to the observed value (user's latest intent) and
///    re-override to the gateway.
pub fn apply_system_dns_override(config_path: &str) -> Result<(), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    // Clear any release flag left by a preceding NetworkDown. This is the
    // only entry point that should clear it — the SCDynamicStore watcher
    // calls `reapply_on_active_primary` directly and must keep skipping
    // while the flag is set (see invariant #5 in docs/claude/dns-override.md).
    {
        let mut slot = ACTIVE_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(active) = slot.as_mut() {
            if active.released {
                log::info!(
                    "[dns] apply: clearing released flag on [{}] before re-apply",
                    active.service
                );
                active.released = false;
            }
        }
    }
    reapply_on_active_primary(&gateway)
}

/// Same logic as `apply_system_dns_override` but with the gateway IP already
/// known. Called from dns_watcher when a change event fires; the gateway
/// lives in the slot so the watcher doesn't need the sing-box config path.
///
/// Short-circuits when the slot's `released` flag is set — see the
/// "ACTIVE_OVERRIDE invariants" section of docs/claude/dns-override.md for
/// why this prevents the NetworkDown release from being reverted by the
/// SCDynamicStore watcher.
pub(crate) fn reapply_on_active_primary(gateway: &str) -> Result<(), String> {
    // Check released under the lock first so watcher callbacks during a
    // NetworkDown release window return immediately without touching Setup.
    {
        let slot = ACTIVE_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(active) = slot.as_ref() {
            if active.released {
                log::debug!(
                    "[dns] reapply: released flag set on [{}], skipping",
                    active.service
                );
                return Ok(());
            }
        }
    }
    let new_service = detect_active_network_service()?;
    let current = read_service_dns(&new_service);
    // Per-call preamble is debug: it fires on every watcher callback, most of
    // which round-trip our own writes and end in the no-op branch. Log readers
    // diagnosing an issue can raise the log level; the interesting-branch info
    // lines below carry the same service/value context.
    log::debug!(
        "[dns] apply: active='{}' current='{}' target='{}'",
        new_service,
        current,
        gateway
    );

    let mut slot = ACTIVE_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner());
    match slot.as_ref() {
        Some(prev) if prev.service == new_service => {
            if current == gateway {
                // Hot path: our own write just round-tripped through
                // SCDynamicStore. Debug-only so it doesn't drown the
                // interesting transitions.
                log::debug!(
                    "[dns] apply: [{}] already set to gateway, nothing to do",
                    new_service
                );
                return Ok(());
            }
            // External write on our current primary. Treat the observed
            // value as the user's latest intent — restore will honour it
            // when TUN stops.
            log::info!(
                "[dns] apply: external write detected on [{}] (was captured='{}' → now '{}'), updating captured",
                new_service,
                prev.captured,
                current
            );
            let mut updated = prev.clone();
            updated.captured = current;
            updated.gateway = gateway.to_string();
            *slot = Some(updated);
            drop(slot); // release lock before syscalls
            macos_helper::api::set_dns_servers(&new_service, gateway)?;
            macos_helper::api::flush_dns_cache().ok();
            log::info!("[dns] apply: re-override [{}] → {}", new_service, gateway);
            Ok(())
        }
        Some(prev) => {
            // Primary switched (e.g. Wi-Fi → Ethernet). Write the previous
            // service's captured value back before we touch the new one, so
            // the user's DNS on the now-idle interface is preserved exactly
            // as they had it before TUN took over.
            log::info!(
                "[dns] apply: primary switched '{}' → '{}', restoring old service first",
                prev.service,
                new_service
            );
            let prev_snap = prev.clone();
            drop(slot);
            if let Err(e) = macos_helper::api::set_dns_servers(&prev_snap.service, &prev_snap.captured) {
                log::warn!(
                    "[dns] apply: restore old [{}] → '{}' failed: {}",
                    prev_snap.service,
                    prev_snap.captured,
                    e
                );
            } else {
                log::info!(
                    "[dns] apply: restored old [{}] → '{}'",
                    prev_snap.service,
                    prev_snap.captured
                );
            }

            // Capture new service's current DNS (or the user's latest
            // intent), override, record slot.
            log::info!(
                "[dns] apply: capture new [{}] original='{}'",
                new_service,
                current
            );
            macos_helper::api::set_dns_servers(&new_service, gateway)?;
            macos_helper::api::flush_dns_cache().ok();
            let mut slot = ACTIVE_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner());
            *slot = Some(ActiveOverride {
                service: new_service.clone(),
                captured: current,
                gateway: gateway.to_string(),
                released: false,
            });
            log::info!("[dns] apply: override [{}] → {}", new_service, gateway);
            Ok(())
        }
        None => {
            // Fresh TUN start. Capture, override, record.
            log::info!(
                "[dns] apply: fresh override, capture [{}] original='{}'",
                new_service,
                current
            );
            macos_helper::api::set_dns_servers(&new_service, gateway)?;
            macos_helper::api::flush_dns_cache().ok();
            *slot = Some(ActiveOverride {
                service: new_service.clone(),
                captured: current,
                gateway: gateway.to_string(),
                released: false,
            });
            log::info!("[dns] apply: override [{}] → {}", new_service, gateway);
            Ok(())
        }
    }
}

/// Write the slot's captured value back, synchronously. Returns the
/// (service, captured) pair when the helper accepted the write — that's the
/// entry eligible for the post-kill verify pass.
///
/// Must run **before** sing-box is killed so the physical NIC default
/// route never briefly inherits the stale `172.19.0.1` gateway IP that
/// becomes unreachable the moment TUN tears down.
fn apply_captured_originals_sync(taken: Option<&ActiveOverride>) -> Option<(String, String)> {
    let Some(active) = taken else {
        log::info!("[dns] phase 1 (pre-kill write): slot empty, skipping");
        return None;
    };
    log::info!(
        "[dns] phase 1 (pre-kill write): restoring [{}] → '{}'",
        active.service,
        active.captured
    );
    if let Err(e) = macos_helper::api::set_dns_servers(&active.service, &active.captured) {
        log::warn!(
            "[dns] phase 1 [{}] write failed: {}",
            active.service,
            e
        );
        return None;
    }
    macos_helper::api::flush_dns_cache().ok();
    log::info!("[dns] phase 1 done, cache flushed");
    Some((active.service.clone(), active.captured.clone()))
}

/// Probe each restored DNS server on UDP/53. If **none** of a service's
/// captured servers respond, release the service to DHCP (write `"empty"`
/// to Setup) so the DHCP-pushed DNS — including a captive portal's internal
/// hijacker — can take over. Must only run AFTER sing-box has exited and
/// TUN has been removed — otherwise every probe is routed through
/// TUN → proxy and all servers look reachable, producing bogus
/// "everything's fine" results.
///
/// Previously this path called `get_best_dns_server` to pick a public
/// fallback, but any hardcoded IP gets read back by the next
/// `reapply_on_active_primary` and fixated as "user intent", polluting
/// all future restores. Writing `"empty"` breaks that cycle.
async fn verify_and_fallback(applied: Option<&(String, String)>) {
    let Some((service, original)) = applied else {
        log::info!("[dns] phase 2 (post-kill verify): nothing to verify, skipping");
        return;
    };
    log::info!(
        "[dns] phase 2 (post-kill verify): probing [{}] '{}'",
        service,
        original
    );
    if original == "empty" {
        // Back to DHCP defaults — there's no single IP to probe; trust
        // whatever DHCP hands out.
        log::info!("[dns] phase 2 [{}] kept DHCP default (no probe)", service);
        return;
    }
    let mut alive_ip: Option<String> = None;
    for ip in original.split_whitespace() {
        log::info!("[dns] phase 2 probe [{}] → {} ...", service, ip);
        if crate::commands::dns::probe_dns_reachable(ip).await {
            alive_ip = Some(ip.to_string());
            break;
        }
    }
    if let Some(ip) = alive_ip {
        log::info!(
            "[dns] phase 2 [{}] {} alive, keeping original '{}'",
            service,
            ip,
            original
        );
        macos_helper::api::flush_dns_cache().ok();
        return;
    }
    log::warn!(
        "[dns] phase 2 [{}] all of '{}' unreachable — releasing to DHCP (writing empty)",
        service,
        original
    );
    // Write "empty" instead of a hardcoded public DNS. Any hardcoded IP
    // (previously `223.5.5.5` via `get_best_dns_server`) is itself blocked in
    // strict captive networks *and* self-propagates: the next
    // `reapply_on_active_primary` reads it back as the new "user intent" and
    // commits it to `ACTIVE_OVERRIDE.captured`, polluting every future restore.
    // See docs/claude/dns-override.md "What we deliberately DON'T do".
    if let Err(e) = macos_helper::api::set_dns_servers(service, "empty") {
        log::warn!(
            "[dns] phase 2 fallback write [{}] → empty failed: {}",
            service,
            e
        );
    } else {
        log::info!("[dns] phase 2 [{}] fell back to empty (DHCP)", service);
    }
    macos_helper::api::flush_dns_cache().ok();
    log::info!("[dns] phase 2 done, cache flushed");
}

/// NetworkDown release: overwrite the active service's Setup DNS with
/// `"empty"` so that, when the device reconnects to a different network on
/// NetworkUp, the OS-native captive-portal detection (Windows NCSI /
/// macOS's own probes) has a clean State layer populated by the new
/// network's DHCP — including a captive hijacker's internal resolver,
/// which is the only resolver that answers pre-auth.
///
/// Sets the slot's `released` flag to `true` before writing so the
/// SCDynamicStore watcher's echo of this write doesn't trigger
/// `reapply_on_active_primary` to "correct" Setup back to the gateway.
/// The flag is cleared by the next `apply_system_dns_override` (the
/// NetworkUp re-apply path).
///
/// Does **not** drain the slot — NetworkUp needs the `service` + `gateway`
/// to re-apply. If the process exits while `released == true`, the slot
/// dies with the process; no on-disk recovery needed.
pub fn release_dns_on_network_down() -> Result<(), String> {
    let (service, prev_gateway) = {
        let mut slot = ACTIVE_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner());
        let Some(active) = slot.as_mut() else {
            log::info!("[dns] NetworkDown: slot empty, nothing to release");
            return Ok(());
        };
        if active.released {
            log::info!(
                "[dns] NetworkDown: [{}] already released, skipping",
                active.service
            );
            return Ok(());
        }
        active.released = true;
        (active.service.clone(), active.gateway.clone())
    };
    log::info!(
        "[dns] NetworkDown: releasing [{}] to empty (was gateway={})",
        service,
        prev_gateway
    );
    macos_helper::api::set_dns_servers(&service, "empty")?;
    macos_helper::api::flush_dns_cache().ok();
    Ok(())
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
    log::info!("[dns] crash-path restore: sing-box already exited, running write + verify");
    let taken = take_active_override();
    let applied = apply_captured_originals_sync(taken.as_ref());
    verify_and_fallback(applied.as_ref()).await;
    log::info!("[dns] crash-path restore: complete");
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
                let child_pid = child.pid();
                log::info!("[sing-box] spawned pid={} mode=SystemProxy", child_pid);
                crate::core::monitor::spawn_process_monitor(
                    app.clone(),
                    rx,
                    Arc::new(mode.clone()),
                    child_pid,
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

    fn on_network_down(_app: &AppHandle) {
        // Release Setup DNS so the next network's OS-native captive
        // detection has a clean State layer to probe against. Slot is
        // preserved — NetworkUp will re-apply via `on_network_up`.
        if let Err(e) = release_dns_on_network_down() {
            log::warn!("[dns] NetworkDown release failed: {}", e);
        }
    }

    fn on_process_terminated(_app: &AppHandle, _was_user_stop: bool) {
        // Cancel the bypass-router watchdog eagerly — its own in-loop mode
        // check would eventually notice TUN is gone, but only after the
        // next 4h sleep, which is too slow.
        watchdog::cancel();
        log::info!("[dns] TUN process terminated — restoring captured original");
        // Async restore runs fire-and-forget. take_active_override drains
        // the slot so if the user-stop path already consumed it, this lands
        // as a harmless no-op (slot None → early return).
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
            // Snapshot which sing-box processes are currently alive BEFORE
            // the SIGHUP. `pkill -HUP sing-box` matches by process name,
            // so if there are multiple sing-box processes (e.g. a leaked
            // one from a previous crash/force-quit), they'll ALL receive
            // the signal — captured here for post-mortem analysis.
            match Command::new("pgrep").args(["-lf", "sing-box"]).output() {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let lines: Vec<&str> = stdout.lines().collect();
                    log::info!(
                        "[reload] pgrep pre-pkill: {} sing-box process(es) {:?}",
                        lines.len(),
                        lines
                    );
                }
                Err(e) => log::warn!("[reload] pgrep pre-pkill failed: {}", e),
            }
            let pm_pid = {
                let m = crate::core::ProcessManager::acquire();
                m.child.as_ref().map(|c| c.pid())
            };
            log::info!("[reload] pm_child_pid={:?} (expected sole SIGHUP target)", pm_pid);

            let output = Command::new("pkill")
                .args(["-HUP", "sing-box"])
                .output()
                .map_err(|e| format!("Failed to send SIGHUP: {}", e))?;
            // pkill exit codes: 0 = matched + signaled, 1 = none matched.
            // Treat "none matched" as a warn so it doesn't silently fail.
            let code = output.status.code();
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !output.status.success() {
                if code == Some(1) {
                    log::warn!(
                        "[reload] pkill -HUP matched 0 processes (code=1) — sing-box may already be dead"
                    );
                    return Err(format!("pkill -HUP matched nothing: {}", stderr));
                }
                return Err(format!(
                    "pkill -HUP non-zero (code={:?}): {}",
                    code, stderr
                ));
            }
            log::info!(
                "[reload] SIGHUP sent via pkill code={:?} stdout={:?} stderr={:?}",
                code,
                stdout.trim(),
                stderr.trim()
            );
        }
        Ok(())
    }
}
