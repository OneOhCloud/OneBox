use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;

/// VPN代理操作的trait定义
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
}

pub mod helper;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

// 平台适配器，使用编译时平台选择
#[cfg(target_os = "linux")]
pub use linux::LinuxVpnProxy as PlatformVpnProxy;
#[cfg(target_os = "macos")]
pub use macos::MacOSVpnProxy as PlatformVpnProxy;
#[cfg(target_os = "windows")]
pub use windows::WindowsVpnProxy as PlatformVpnProxy;
