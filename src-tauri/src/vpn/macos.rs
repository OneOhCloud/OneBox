use anyhow;
use std::process::Command;
use sysproxy::Sysproxy;
use tauri::AppHandle;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;

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
        host: config.host,
        port: config.port,
        bypass: config.bypass,
    };
    sys.set_system_proxy()?;
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(_app: &AppHandle) -> anyhow::Result<()> {
    // 清理系统代理设置
    let mut sysproxy = Sysproxy::get_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    sysproxy.enable = false;

    sysproxy
        .set_system_proxy()
        .map_err(|e| anyhow::anyhow!(e))?;
    println!("Proxy unset");
    Ok(())
}

/// 特权模式下启动进程
pub fn create_privileged_command(
    app: &AppHandle,
    sidecar_path: String,
    path: String,
    password: String,
) -> Option<TauriCommand> {
    let command = format!(
        r#"echo '{}' | sudo -S '{}' run -c '{}' --disable-color"#,
        password.escape_default(),
        sidecar_path.escape_default(),
        path.escape_default()
    );
    Some(app.shell().command("sh").args(vec!["-c", &command]))
}

/// 停止TUN模式下的进程
pub fn stop_tun_process(password: &str) -> Result<(), String> {
    let command = format!("echo '{}' | sudo -S pkill -9 -f sing-box", password);
    println!("Executing command: {}", command);
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}
