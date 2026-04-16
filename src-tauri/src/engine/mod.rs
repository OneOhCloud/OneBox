use tauri::AppHandle;

use crate::core::ProxyMode;

pub const EVENT_TAURI_LOG: &str = "tauri-log";
pub const EVENT_STATUS_CHANGED: &str = "status-changed";

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

    /// Restore system DNS after the sing-box process has terminated.
    /// Called from the process monitor; implementations read any per-
    /// platform teardown state from their own module. `was_user_stop`
    /// lets platforms distinguish the fast path (user stop, state already
    /// teardown'd) from the crash-recovery path (external kill, UAC
    /// fallback needed on Windows).
    fn on_process_terminated(_app: &AppHandle, _was_user_stop: bool) {}
}

pub mod helper;
pub mod readiness;
pub mod state_machine;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

// macOS helper commands exposed to generate_handler! at the engine:: level.
// On macOS these delegate to the real XPC helper (blocking FFI, wrapped in
// spawn_blocking); on other platforms they return an error.
#[tauri::command]
pub async fn helper_ping() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(macos::helper::api::ping)
            .await
            .map_err(|e| format!("helper_ping join error: {}", e))?
    }
    #[cfg(not(target_os = "macos"))]
    { Err("macOS only".into()) }
}

#[tauri::command]
pub async fn helper_install() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(macos::helper::api::install)
            .await
            .map_err(|e| format!("helper_install join error: {}", e))?
    }
    #[cfg(not(target_os = "macos"))]
    { Err("macOS only".into()) }
}

#[cfg(target_os = "linux")]
pub use linux::LinuxEngine as PlatformEngine;
#[cfg(target_os = "macos")]
pub use macos::MacOSEngine as PlatformEngine;
#[cfg(target_os = "windows")]
pub use windows::WindowsEngine as PlatformEngine;

/// Apply the platform's HTTP/SOCKS system-proxy override. Shared entry
/// point so `core::*` does not need per-platform cfg gates to call
/// individual `engine::<platform>::set_proxy` free functions.
pub(crate) async fn apply_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    { macos::set_proxy(app).await }
    #[cfg(target_os = "linux")]
    { linux::set_proxy(app).await }
    #[cfg(target_os = "windows")]
    { windows::set_proxy(app).await }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    { let _ = app; Ok(()) }
}

/// Clear the platform's HTTP/SOCKS system-proxy override.
pub(crate) async fn clear_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    { macos::unset_proxy(app).await }
    #[cfg(target_os = "linux")]
    { linux::unset_proxy(app).await }
    #[cfg(target_os = "windows")]
    { windows::unset_proxy(app).await }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    { let _ = app; Ok(()) }
}

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
