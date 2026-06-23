//! Cross-platform system HTTP/SOCKS proxy override.
//!
//! All platforms shell through `onebox_sysproxy_rs` — the only thing that
//! varies is the per-OS bypass-list syntax (comma vs semicolon, glob vs CIDR)
//! and the clear strategy. The macOS service-name resolution, exit-status
//! checking, and "disable proxy on every service pointing at us" clear all
//! live in the crate (v0.0.2+), so there is no per-OS networksetup code here.
//!
//! Proxy always points at the Mixed inbound's listen port.
//!
//! `set_*` emits a frontend log line (Windows historically did, macOS
//! and Linux did not — we now do it on all three for symmetry); failure
//! returns `anyhow::Error` so callers can fall through their usual
//! state-machine error path.

use tauri::{AppHandle, Emitter};

use crate::{core::mixed_proxy_port, engine::EVENT_TAURI_LOG};

const PROXY_HOST: &str = "127.0.0.1";

/// Bypass-list syntax differs per platform — see the `onebox_sysproxy_rs`
/// source for exactly how it's parsed. The values below were migrated
/// verbatim from the previous per-platform duplicates.
#[cfg(target_os = "macos")]
const DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

#[cfg(target_os = "linux")]
const DEFAULT_BYPASS: &str =
    "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";

#[cfg(target_os = "windows")]
const DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
const DEFAULT_BYPASS: &str = "localhost,127.0.0.1";

/// Apply the HTTP/SOCKS system proxy pointing at the Mixed inbound.
pub(crate) async fn set_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let proxy_port = mixed_proxy_port(app);
    let _ = app.emit(
        EVENT_TAURI_LOG,
        (
            0,
            format!("Start set system proxy: {}:{}", PROXY_HOST, proxy_port),
        ),
    );
    platform_set_system_proxy(proxy_port, DEFAULT_BYPASS)?;
    log::info!("Proxy set to {}:{}", PROXY_HOST, proxy_port);
    Ok(())
}

/// Clear whatever proxy was set. On macOS this disables the proxy on every
/// service still pointing at OneBox (handles an interface switch since start);
/// on other platforms it flips the active service's `enable` to false.
pub(crate) async fn clear_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let _ = app.emit(EVENT_TAURI_LOG, (0, "Start unset system proxy"));
    if let Err(e) = platform_clear_system_proxy() {
        let msg = format!("clear system proxy failed: {}", e);
        let _ = app.emit(EVENT_TAURI_LOG, (1, msg.clone()));
        return Err(anyhow::anyhow!(msg));
    }
    let _ = app.emit(EVENT_TAURI_LOG, (0, "System proxy unset successfully"));
    log::info!("Proxy unset");
    Ok(())
}

/// Synchronous proxy clear for shutdown / power-off hooks that run outside an
/// async runtime. Routes through the same per-platform clear as the async path
/// — notably the macOS service-name-aware clear — instead of the upstream
/// crate's `get_system_proxy`, which choked on a renamed service during
/// shutdown ("failed to parse string `port`").
pub(crate) fn clear_system_proxy_blocking() -> anyhow::Result<()> {
    platform_clear_system_proxy()
}

/// Apply the proxy on the active service. Cross-platform: macOS service
/// resolution + exit-status checking live in `onebox_sysproxy_rs`, so a failed
/// `networksetup` call now returns an error here instead of being swallowed.
fn platform_set_system_proxy(port: u16, bypass: &str) -> anyhow::Result<()> {
    let sys = onebox_sysproxy_rs::Sysproxy {
        enable: true,
        host: PROXY_HOST.to_string(),
        port,
        bypass: bypass.to_string(),
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))
}

/// macOS: disable the proxy on every service still pointing at OneBox, so a
/// stale proxy isn't left behind if the active interface changed since start.
#[cfg(target_os = "macos")]
fn platform_clear_system_proxy() -> anyhow::Result<()> {
    onebox_sysproxy_rs::clear_proxy(PROXY_HOST).map_err(|e| anyhow::anyhow!(e))
}

/// Other platforms: read the current setting and flip `enable` off, keeping any
/// non-proxy fields (bypass list) intact.
#[cfg(not(target_os = "macos"))]
fn platform_clear_system_proxy() -> anyhow::Result<()> {
    let mut sysproxy = onebox_sysproxy_rs::Sysproxy::get_system_proxy()
        .map_err(|e| anyhow::anyhow!("Sysproxy::get_system_proxy failed: {}", e))?;
    sysproxy.enable = false;
    sysproxy
        .set_system_proxy()
        .map_err(|e| anyhow::anyhow!("Sysproxy::set_system_proxy failed: {}", e))
}
