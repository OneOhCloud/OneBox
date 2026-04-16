use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;

pub const EVENT_TAURI_LOG: &str = "tauri-log";
pub const EVENT_STATUS_CHANGED: &str = "status-changed";

/// Platform-specific sing-box engine management trait.
///
/// Each platform implements proxy setup/teardown and privileged TUN operations
/// via its native mechanism (pkexec on Linux, XPC helper on macOS, SCM service
/// on Windows).
#[allow(async_fn_in_trait)]
pub trait EngineManager {
    async fn set_proxy(app: &AppHandle) -> anyhow::Result<()>;
    async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()>;

    /// Build the platform-specific privileged command to start sing-box in TUN mode.
    /// Returns None if the platform manages the process externally (e.g. macOS helper).
    fn create_privileged_command(
        app: &AppHandle,
        sidecar_path: String,
        path: String,
    ) -> Option<TauriCommand>;

    /// Stop the TUN-mode sing-box process via the platform's privilege mechanism.
    fn stop_tun_process() -> Result<(), String>;

    /// Restore system DNS after TUN process termination.
    /// Called from the process termination handler with platform-opaque context:
    /// - `was_user_stop`: true if the user explicitly stopped the engine
    /// - `dns_info`: Linux-only original DNS state captured at start
    /// Re-apply TUN gateway DNS override after a network change.
    /// Returns `Some((iface, dns))` on Linux so the caller can store
    /// the updated override state; other platforms return `None`.
    fn reapply_dns_override(_config_path: &str) -> Option<(String, String)> {
        None
    }

    fn restore_dns_after_termination(
        _was_user_stop: bool,
        _dns_info: Option<(String, String)>,
    ) {
    }

    /// Reload the running sing-box engine with the current on-disk config,
    /// and flush the OS DNS resolver cache so entries keyed to the previous
    /// config (FakeIPs, Chinese-domain answers, etc.) don't linger for their
    /// full TTL after the switch.
    ///
    /// Each platform bundles reload + flush behind this one method so the
    /// caller does not have to coordinate them:
    ///   - macOS: SIGHUP via XPC helper (TUN) or `pkill -HUP` (SystemProxy),
    ///     plus `dscacheutil -flushcache` + `killall -HUP mDNSResponder`
    ///     through the helper.
    ///   - Linux: a single pkexec to the shell helper whose `reload` verb
    ///     runs `pkill -HUP sing-box` followed by `resolvectl flush-caches`.
    ///   - Windows: SCM stop+start of OneBoxTunService; the service itself
    ///     runs `ipconfig /flushdns` from SYSTEM context inside
    ///     `service_main`, so no separate user-side call is needed
    ///     (`ipconfig /flushdns` requires elevation on Windows 10+).
    ///
    /// `is_tun` is TRUE when the currently running mode is TunProxy; FALSE
    /// for SystemProxy. Platforms that only apply DNS overrides in TUN
    /// mode can skip the flush on FALSE, but the helper invocations
    /// handle this internally.
    async fn reload_engine(app: &AppHandle, is_tun: bool) -> Result<(), String>;
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
