use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub const EVENT_TAURI_LOG: &str = "tauri-log";
pub const EVENT_STATUS_CHANGED: &str = "status-changed";

/// Which kind of proxy the engine is driving. Used both as a state tag
/// (stored in `core::ProcessManager`) and as a parameter to
/// `EngineManager::start`.
#[derive(Clone, Default, PartialEq, Serialize, Deserialize, Debug)]
pub enum ProxyMode {
    #[default]
    SystemProxy,
    TunProxy,
}

/// Platform-specific sing-box engine management.
///
/// `core::*` is only allowed to call the five verbs on this trait —
/// `start`, `stop`, `restart`, `on_network_up`, `on_process_terminated`.
/// Everything else (privileged command construction, sidecar spawning,
/// DNS overrides, helper IPC, service registration, per-mode watchdogs)
/// is encapsulated inside `engine::{macos,linux,windows}` and must not
/// leak through this trait.
#[allow(async_fn_in_trait)]
pub trait EngineManager {
    /// Start the engine in the given mode. Implementations are responsible
    /// for: privilege escalation (helper XPC / pkexec / SCM service), DNS
    /// overrides, spawning or controlling the sing-box process, setting up
    /// per-mode watchdogs, applying/clearing the system proxy as the mode
    /// requires, and seeding `ProcessManager` with the running
    /// mode/config/child handle before returning `Ok(())`.
    async fn start(
        app: &AppHandle,
        mode: ProxyMode,
        config_path: String,
    ) -> Result<(), String>;

    /// Initiate an orderly stop of the engine: signal sing-box to exit,
    /// clear the system proxy if it was configured, and return once the
    /// stop request has been dispatched. The actual process exit is
    /// observed asynchronously by the process monitor which then invokes
    /// `on_process_terminated` for the DNS / state cleanup.
    async fn stop(app: &AppHandle) -> Result<(), String>;

    /// Reload the running engine with the current on-disk config and
    /// flush the OS DNS resolver cache so entries keyed to the previous
    /// config (FakeIPs under global mode, Chinese-domain answers, etc.)
    /// don't linger for their full TTL after the switch.
    async fn restart(app: &AppHandle) -> Result<(), String>;

    /// Notify the engine of a system NetworkUp event (Wi-Fi switch, wake
    /// from sleep, DHCP renewal). Engines that override DNS re-apply the
    /// override on the active interface; others are no-ops.
    fn on_network_up(_app: &AppHandle) {}

    /// Notify the engine of a system NetworkDown event. Engines that
    /// override DNS may release the Setup layer here so that OS-native
    /// captive detection on the next NetworkUp has a clean State to probe
    /// against. Only macOS implements this today — Windows needs a new
    /// SCM service control verb and Linux has no lifecycle listener. See
    /// docs/claude/dns-override.md "What we deliberately DON'T do".
    fn on_network_down(_app: &AppHandle) {}

    /// Restore system DNS after the sing-box process has terminated.
    /// Called from the process monitor; implementations read any per-
    /// platform teardown state from their own module. `was_user_stop`
    /// lets platforms distinguish the fast path (user stop, state already
    /// teardown'd) from the crash-recovery path (external kill, UAC
    /// fallback needed on Windows).
    fn on_process_terminated(_app: &AppHandle, _was_user_stop: bool) {}

    /// Idempotently install the platform's privileged companion:
    ///   - macOS: SMJobBless → /Library/PrivilegedHelperTools/…
    ///   - Windows: SCM CreateService → OneBoxTunService
    ///   - Linux: no-op (helper script + polkit policy ship in the .deb/.rpm)
    ///
    /// Prompts for OS-level authorization on first call (Touch ID / UAC).
    /// Safe to call repeatedly — subsequent calls are fast no-ops once the
    /// companion is installed.
    async fn ensure_installed(app: &AppHandle) -> Result<(), String>;

    /// Smoke-test that the privileged companion is reachable. macOS does
    /// an XPC `ping`, Windows queries the SCM service state, Linux stats
    /// the helper script on disk. Returns a short human-readable string
    /// (`"pong"`, `"running"`, `"available"`) on success.
    async fn probe(app: &AppHandle) -> Result<String, String>;

    /// How long core should wait after `start()` returns before handing
    /// off to the readiness prober. TUN mode takes longer because it
    /// round-trips through the privileged companion (XPC / SCM / pkexec)
    /// before sing-box actually starts accepting connections; SystemProxy
    /// just spawns a user-mode sidecar. Default covers both; override if
    /// a specific platform needs a different cadence.
    fn start_settle_delay(mode: &ProxyMode) -> std::time::Duration {
        match mode {
            ProxyMode::TunProxy => std::time::Duration::from_millis(1500),
            ProxyMode::SystemProxy => std::time::Duration::from_millis(1000),
        }
    }
}

pub mod common;
pub use common::{helper, readiness, state_machine};
pub(crate) use common::sysproxy;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// Dev probe: install the platform's privileged companion (macOS helper
/// via SMJobBless, Windows SCM service via CreateService) if not already
/// installed. Linux is a no-op. Surfaces the OS-level authorization prompt
/// on first call.
#[tauri::command]
pub async fn engine_ensure_installed(app: AppHandle) -> Result<(), String> {
    PlatformEngine::ensure_installed(&app).await
}

/// Dev probe: round-trip a liveness check to the privileged companion.
/// Returns a short status string or a descriptive error.
#[tauri::command]
pub async fn engine_probe(app: AppHandle) -> Result<String, String> {
    PlatformEngine::probe(&app).await
}

#[cfg(target_os = "linux")]
pub use linux::LinuxEngine as PlatformEngine;
#[cfg(target_os = "macos")]
pub use macos::MacOSEngine as PlatformEngine;
#[cfg(target_os = "windows")]
pub use windows::WindowsEngine as PlatformEngine;

/// Re-export the cross-platform system-proxy entry points so existing
/// `core::*` call sites (`engine::apply_system_proxy`, etc.) keep working.
pub(crate) use sysproxy::set_system_proxy as apply_system_proxy;
pub(crate) use sysproxy::clear_system_proxy;

/// Clean up system proxy settings on app shutdown.
pub fn cleanup_on_shutdown() {
    use onebox_sysproxy_rs::Sysproxy;
    let mut sysproxy = match Sysproxy::get_system_proxy() {
        Ok(proxy) => proxy,
        Err(e) => {
            log::error!("Sysproxy::get_system_proxy failed during shutdown: {}", e);
            return;
        }
    };
    sysproxy.enable = false;
    if let Err(e) = sysproxy.set_system_proxy() {
        log::error!("Failed to unset system proxy during shutdown: {}", e);
    } else {
        log::info!("System proxy unset during shutdown");
    }
}
