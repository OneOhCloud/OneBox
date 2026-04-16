use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;

pub const EVENT_TAURI_LOG: &str = "tauri-log";
pub const EVENT_STATUS_CHANGED: &str = "status-changed";

/// Platform-specific sing-box engine management.
///
/// The long-term goal of this trait is for `core::*` to only call four
/// verbs — `start`, `stop`, `restart`, `on_network_up` — with everything
/// platform-specific (privileged command construction, DNS overrides,
/// helper IPC, service registration, per-mode watchdogs) living inside
/// `engine::{macos,linux,windows}`. This commit performs the first half
/// of that migration: it replaces the old leaky shapes
/// (`reload_engine(app, is_tun)`, `reapply_dns_override` returning a
/// Linux-shaped tuple, `restore_dns_after_termination` taking that tuple)
/// with cleaner verbs. `start`/`stop` still flow through the legacy
/// per-platform helpers and will be migrated in a follow-up commit.
#[allow(async_fn_in_trait)]
pub trait EngineManager {
    /// Reload the running engine with the current on-disk config and
    /// flush the OS DNS resolver cache so entries keyed to the previous
    /// config (FakeIPs under global mode, Chinese-domain answers, etc.)
    /// don't linger for their full TTL after the switch.
    ///
    /// Implementations must read the running mode from their own state
    /// (ProcessManager, a platform-local OnceCell, …) — callers no longer
    /// have to pass it in.
    async fn restart(app: &AppHandle) -> Result<(), String>;

    /// Notify the engine of a system NetworkUp event (Wi-Fi switch, wake
    /// from sleep, DHCP renewal). Engines that override DNS re-apply the
    /// override on the active interface; others are no-ops. Return value
    /// (success/failure) is informational only — NetworkUp is
    /// best-effort and the caller does not branch on it.
    fn on_network_up(_app: &AppHandle) {}

    /// Restore system DNS after the sing-box process has terminated,
    /// either cleanly (user stop) or unexpectedly (crash, external kill).
    /// Implementations read any per-platform teardown state from their
    /// own module — the parameters previously used to thread Linux's
    /// `(iface, original_dns)` tuple through `core` are gone.
    fn on_process_terminated(_app: &AppHandle, _was_user_stop: bool) {}

    // ── Legacy (being migrated away) ────────────────────────────────
    // Still used by `core::start` and `core::stop` until the second
    // refactor commit collapses them behind a clean `start`/`stop` pair.

    async fn set_proxy(app: &AppHandle) -> anyhow::Result<()>;
    async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()>;
    fn create_privileged_command(
        app: &AppHandle,
        sidecar_path: String,
        path: String,
    ) -> Option<TauriCommand>;
    fn stop_tun_process() -> Result<(), String>;
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
