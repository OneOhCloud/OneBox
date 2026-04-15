use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;

pub const EVENT_TAURI_LOG: &str = "tauri-log";
pub const EVENT_STATUS_CHANGED: &str = "status-changed";

/// VPN代理操作的trait定义
///
/// `async fn` in trait 不带 `Send` 边界,但本 trait 的所有实现都是平台特定 struct
/// 上的 inherent fn 转发,调用方(core.rs)不会跨线程持有 Future。允许该警告。
#[allow(async_fn_in_trait)]
pub trait VpnProxy {
    /// 设置系统代理
    async fn set_proxy(app: &AppHandle) -> anyhow::Result<()>;

    /// 取消系统代理
    async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()>;

    /// 创建特权模式命令
    fn create_privileged_command(
        app: &AppHandle,
        sidecar_path: String,
        path: String,
        password: String,
    ) -> Option<TauriCommand>;

    /// 停止TUN模式进程
    fn stop_tun_process(password: &str) -> Result<(), String>;

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
pub mod readiness;
pub mod state_machine;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub mod windows_native;

// 平台适配器，使用编译时平台选择
#[cfg(target_os = "linux")]
pub use linux::LinuxVpnProxy as PlatformVpnProxy;
#[cfg(target_os = "macos")]
pub use macos::MacOSVpnProxy as PlatformVpnProxy;
#[cfg(target_os = "windows")]
pub use windows::WindowsVpnProxy as PlatformVpnProxy;

pub fn unset_proxy_on_shutdown() {
    use onebox_sysproxy_rs::Sysproxy;
    // 关机前先清理系统代理设置，避免下次开机网络
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
