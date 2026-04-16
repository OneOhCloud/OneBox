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

    #[cfg(target_os = "windows")]
    fn restart(sidecar_path: String, path: String) {
        let _ = sidecar_path;
        let _ = path;
    }
}

pub mod helper;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub mod macos_helper;
pub mod readiness;
pub mod state_machine;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub mod windows_native;

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
