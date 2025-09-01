use crate::vpn::VpnProxy;
use anyhow;
use std::process::Command;
use sysproxy::Sysproxy;
use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

// 默认绕过列表
pub static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

/// 代理配置
#[derive(Clone)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    pub bypass: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 6789,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}

/// 设置系统代理
pub async fn set_proxy(_app: &AppHandle) -> anyhow::Result<()> {
    let config = ProxyConfig::default();
    let sys = Sysproxy {
        enable: true,
        host: config.host.clone(),
        port: config.port.clone(),
        bypass: config.bypass,
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy set to {}:{}", config.host, config.port);
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(_app: &AppHandle) -> anyhow::Result<()> {
    // 清理系统代理设置
    let mut sysproxy = Sysproxy::get_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    sysproxy.enable = false;
    sysproxy.set_system_proxy()?;
    log::info!("Proxy unset");
    Ok(())
}

/// 特权模式下启动进程
pub fn create_privileged_command(
    app: &AppHandle,
    sidecar_path: String,
    path: String,
    password: String,
) -> Option<TauriCommand> {
    let store = app.get_store("settings.json")?;
    let enable_bypass_router_key = "enable_bypass_router_key";
    let enable_bypass_router: bool = store
        .get(enable_bypass_router_key)
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let command = format!(
        r#"echo '{}' | sudo -S '{}' run -c '{}' --disable-color"#,
        password.escape_default(),
        sidecar_path.escape_default(),
        path.escape_default()
    );
    log::info!(
        "Enable tun mode with command: {}",
        command.replace(password.as_str(), "******")
    );

    // 如果启用了旁路由模式，则开启IP转发
    if enable_bypass_router {
        let command = format!(
            "echo '{}' | sudo -S sysctl -w net.inet.ip.forwarding=1",
            password
        );
        log::info!(
            "Enable IP forwarding with command : {}",
            command.replace(password.as_str(), "******")
        );
        let _ = Command::new("sh")
            .arg("-c")
            .arg(command)
            .output()
            .map_err(|e| e.to_string());
    }

    Some(app.shell().command("sh").args(vec!["-c", &command]))
}

/// 停止TUN模式下的进程
pub fn stop_tun_process(password: &str) -> Result<(), String> {
    let command = format!("echo '{}' | sudo -S pkill -15 -f sing-box", password);
    log::info!(
        "Stop tun mode with command : {}",
        command.replace(password, "******")
    );
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;

    // 关闭IP转发
    let command = format!(
        "echo '{}' | sudo -S sysctl -w net.inet.ip.forwarding=0",
        password
    );
    log::info!(
        "Disable IP forwarding with command : {}",
        command.replace(password, "******")
    );
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// macOS平台的VPN代理实现
pub struct MacOSVpnProxy;

impl VpnProxy for MacOSVpnProxy {
    async fn set_proxy(_app: &AppHandle) -> anyhow::Result<()> {
        set_proxy(_app).await
    }

    async fn unset_proxy(_app: &AppHandle) -> anyhow::Result<()> {
        unset_proxy(_app).await
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
