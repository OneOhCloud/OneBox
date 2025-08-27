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
use crate::vpn::privilege_controller::PrivilegeControllerClient;
use crate::vpn::VpnProxy;
// 默认绕过列表
pub static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";

// 特权控制器端口
pub static PRIVILEGE_CONTROLLER_PORT: u16 = 18888;

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

/// 启动特权控制器进程（使用 Windows ShellExecuteW UAC 提权）
#[cfg(target_os = "windows")]
pub fn start_privilege_controller() -> Result<(), String> {
    let controller_path = match helper::get_sidecar_path(Path::new("privilege-controller")) {
        Ok(path) => path,
        Err(e) => return Err(format!("Failed to get controller path: {}", e)),
    };

    let args = format!("{}", PRIVILEGE_CONTROLLER_PORT);
    let controller_wide: Vec<u16> = OsStr::new(&controller_path)
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
            PCWSTR(controller_wide.as_ptr()),
            PCWSTR(args_wide.as_ptr()),
            PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(0),
        )
    };

    if res.0 as usize <= 32 {
        return Err(format!("ShellExecuteW failed: code {}", res.0 as usize));
    }

    log::info!(
        "Started privilege controller with command: {} {}",
        controller_path,
        args
    );

    // 等待控制器启动
    let client = PrivilegeControllerClient::new(PRIVILEGE_CONTROLLER_PORT);
    for _ in 0..50 {
        // 最多等待5秒
        if client.is_controller_running() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    Err("Timeout waiting for privilege controller to start".to_string())
}

/// 通过特权控制器启动sing-box
pub fn start_sing_box_via_controller(config_path: &str) -> Result<(), String> {
    let client = PrivilegeControllerClient::new(PRIVILEGE_CONTROLLER_PORT);

    // 如果控制器未运行，先启动它
    if !client.is_controller_running() {
        start_privilege_controller()?;
    }

    // 获取sing-box路径
    let sing_box_path = helper::get_sidecar_path(Path::new("sing-box"))
        .map_err(|e| format!("Failed to get sing-box path: {}", e))?;

    // 通过控制器启动sing-box
    client
        .start_sing_box(&sing_box_path, config_path)
        .map_err(|e| format!("Failed to start sing-box via controller: {}", e))
}

/// 通过特权控制器停止sing-box
pub fn stop_sing_box_via_controller() -> Result<(), String> {
    let client = PrivilegeControllerClient::new(PRIVILEGE_CONTROLLER_PORT);

    if !client.is_controller_running() {
        return Ok(()); // 控制器未运行，说明sing-box也未运行
    }

    client
        .stop_sing_box()
        .map_err(|e| format!("Failed to stop sing-box via controller: {}", e))
}

/// 检查sing-box是否通过控制器运行
pub fn is_sing_box_running_via_controller() -> bool {
    let client = PrivilegeControllerClient::new(PRIVILEGE_CONTROLLER_PORT);

    if !client.is_controller_running() {
        return false;
    }

    client.get_status().unwrap_or(false)
}

/// 特权模式下启动进程（现在通过特权控制器）
#[cfg(target_os = "windows")]
pub fn create_privileged_command(
    _app: &AppHandle,
    _sidecar_path: String,
    path: String,
    _password: String,
) -> Option<TauriCommand> {
    // 通过特权控制器启动sing-box，不再直接返回TauriCommand
    if let Err(e) = start_sing_box_via_controller(&path) {
        log::error!("Failed to start sing-box via privilege controller: {}", e);
    }
    None // 不返回命令，因为是通过socket控制的
}

/// 停止TUN模式下的进程（现在通过特权控制器）
#[cfg(target_os = "windows")]
pub fn stop_tun_process(_password: &str) -> Result<(), String> {
    stop_sing_box_via_controller()
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
}
