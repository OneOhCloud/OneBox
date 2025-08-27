use anyhow;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;

use crate::vpn::helper;
use crate::vpn::VpnProxy;
// 默认绕过列表
pub static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";

/// 代理配置
#[derive(Clone)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 6789,
        }
    }
}

/// 设置系统代理
pub async fn set_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let config = ProxyConfig::default();
    let address = format!("{}:{}", config.host, config.port);
    let sidecar_path = helper::get_sidecar_path(Path::new("sysproxy"))?;

    let sidecar_command =
        app.shell()
            .command(sidecar_path)
            .args(["global", &address, DEFAULT_BYPASS]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to set proxy: {}", e))?;
    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "Failed to set proxy: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    log::info!("Proxy set to {}:{}", config.host, config.port);
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let sidecar_path = helper::get_sidecar_path(Path::new("sysproxy"))?;

    let sidecar_command = app.shell().command(sidecar_path).args(["set", "1"]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to unset proxy: {}", e))?;
    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "Failed to unset proxy: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    log::info!("Proxy unset");
    Ok(())
}

/// 特权模式下启动进程（使用 Windows ShellExecuteW UAC 提权）
#[cfg(target_os = "windows")]
pub fn create_privileged_command(
    _app: &AppHandle,
    sidecar_path: String,
    path: String,
    _password: String,
) -> Option<TauriCommand> {
    let args = format!("run -c {} --disable-color", path);
    let sidecar_wide: Vec<u16> = OsStr::new(&sidecar_path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let args_wide: Vec<u16> = OsStr::new(&args).encode_wide().chain(Some(0)).collect();
    let verb = OsStr::new("runas")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let res = unsafe {
        ShellExecuteW(
            HWND(0),
            PCWSTR(verb.as_ptr()),
            PCWSTR(sidecar_wide.as_ptr()),
            PCWSTR(args_wide.as_ptr()),
            PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(0),
        )
    };
    if res.0 as usize <= 32 {
        panic!("ShellExecuteW failed: code {}", res.0 as usize);
    }
    log::info!("Enable tun mode with command: {} {}", sidecar_path, args);
    None
}

/// 停止TUN模式下的进程（使用 Windows ShellExecuteW UAC 提权）
#[cfg(target_os = "windows")]
pub fn stop_tun_process(_password: &str) -> Result<(), String> {
    let taskkill = OsStr::new("taskkill")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let args = OsStr::new("/F /IM sing-box.exe")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let verb = OsStr::new("runas")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let res = unsafe {
        ShellExecuteW(
            HWND(0),
            PCWSTR(verb.as_ptr()),
            PCWSTR(taskkill.as_ptr()),
            PCWSTR(args.as_ptr()),
            PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(0),
        )
    };
    if res.0 as usize <= 32 {
        return Err(format!("ShellExecuteW failed: code {}", res.0 as usize));
    }

    log::info!("Stop tun mode with command: taskkill /F /IM sing-box.exe");
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn restart_privileged_command(sidecar_path: String, path: String) -> Result<(), String> {
    // 使用 PowerShell 脚本，路径处理更可靠
    let ps_script = format!(
        "Stop-Process -Name 'sing-box' -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; & '{}' run -c '{}' --disable-color",
        sidecar_path.replace("\\", "/"), // PowerShell 接受正斜杠
        path.replace("\\", "/")
    );

    let powershell = OsStr::new("powershell")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();

    let args = format!("-Command \"{}\"", ps_script);
    let args_wide: Vec<u16> = OsStr::new(&args).encode_wide().chain(Some(0)).collect();

    let verb = OsStr::new("runas")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();

    let res = unsafe {
        ShellExecuteW(
            HWND(0),
            PCWSTR(verb.as_ptr()),
            PCWSTR(powershell.as_ptr()),
            PCWSTR(args_wide.as_ptr()),
            PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(0),
        )
    };

    if res.0 as usize <= 32 {
        return Err(format!("ShellExecuteW failed: code {}", res.0 as usize));
    }

    log::info!("Restart tun mode with PowerShell command: {}", ps_script);
    Ok(())
}

/// Windows平台的VPN代理实现
pub struct WindowsVpnProxy;

impl VpnProxy for WindowsVpnProxy {
    async fn set_proxy(app: &AppHandle) -> anyhow::Result<()> {
        set_proxy(app).await
    }

    async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()> {
        unset_proxy(app).await
    }

    fn create_privileged_command(
        app: &AppHandle,
        sidecar_path: String,
        path: String,
        password: String,
    ) -> Option<TauriCommand> {
        create_privileged_command(app, sidecar_path, path, password)
    }

    fn stop_tun_process(password: &str) -> Result<(), String> {
        stop_tun_process(password)
    }

    fn restart(sidecar_path: String, path: String) {
        let _ = restart_privileged_command(sidecar_path, path);
    }
}
