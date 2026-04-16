//! Cross-platform system HTTP/SOCKS proxy override.
//!
//! All three platforms shell through `onebox_sysproxy_rs` — the only
//! thing that varies is the per-OS bypass-list syntax (comma vs
//! semicolon, glob vs CIDR). Collapsing into one module kills three
//! near-identical copies in the platform mods.
//!
//! Proxy always points at the Mixed inbound's fixed listen port
//! (127.0.0.1:6789). The port is hard-coded in the sing-box config
//! templates so there's nothing to plumb.
//!
//! `set_*` emits a frontend log line (Windows historically did, macOS
//! and Linux did not — we now do it on all three for symmetry); failure
//! returns `anyhow::Error` so callers can fall through their usual
//! state-machine error path.

use onebox_sysproxy_rs::Sysproxy;
use tauri::{AppHandle, Emitter};

use crate::engine::EVENT_TAURI_LOG;

const PROXY_HOST: &str = "127.0.0.1";
const PROXY_PORT: u16 = 6789;

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
    let _ = app.emit(
        EVENT_TAURI_LOG,
        (0, format!("Start set system proxy: {}:{}", PROXY_HOST, PROXY_PORT)),
    );
    let sys = Sysproxy {
        enable: true,
        host: PROXY_HOST.to_string(),
        port: PROXY_PORT,
        bypass: DEFAULT_BYPASS.to_string(),
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy set to {}:{}", PROXY_HOST, PROXY_PORT);
    Ok(())
}

/// Clear whatever proxy was set. Reads the current setting first so we
/// keep any non-proxy fields (bypass list) intact — only flip `enable`
/// to false, matching the old per-platform behavior.
pub(crate) async fn clear_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let _ = app.emit(EVENT_TAURI_LOG, (0, "Start unset system proxy"));
    let mut sysproxy = match Sysproxy::get_system_proxy() {
        Ok(proxy) => proxy,
        Err(e) => {
            let msg = format!("Sysproxy::get_system_proxy failed: {}", e);
            let _ = app.emit(EVENT_TAURI_LOG, (1, msg.clone()));
            return Err(anyhow::anyhow!(msg));
        }
    };
    sysproxy.enable = false;
    if let Err(e) = sysproxy.set_system_proxy() {
        let msg = format!("Sysproxy::set_system_proxy failed: {}", e);
        let _ = app.emit(EVENT_TAURI_LOG, (1, msg.clone()));
        return Err(anyhow::anyhow!(msg));
    }
    let _ = app.emit(EVENT_TAURI_LOG, (0, "System proxy unset successfully"));
    log::info!("Proxy unset");
    Ok(())
}
