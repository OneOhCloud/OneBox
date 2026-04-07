use crate::vpn::VpnProxy;
use crate::vpn::EVENT_TAURI_LOG;
use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::process::Command as TauriCommand;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
pub const TUN_INTERFACE_NAME: &str = "utun233";

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
        port: config.port,
        bypass: config.bypass,
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy set to {}:{}", config.host, config.port);
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()> {
    // 清理系统代理设置
    // 使用 ok() 忽略 emit 错误，避免关机/退出时 event system 已拆除导致 panic
    app.emit(EVENT_TAURI_LOG, (0, "Start unset system proxy"))
        .ok();

    let mut sysproxy = match Sysproxy::get_system_proxy() {
        Ok(proxy) => proxy,
        Err(e) => {
            let msg = format!("Sysproxy::get_system_proxy failed: {}", e);
            app.emit(EVENT_TAURI_LOG, (1, msg.clone())).ok();
            return Err(anyhow::anyhow!(msg));
        }
    };
    sysproxy.enable = false;
    if let Err(e) = sysproxy.set_system_proxy() {
        let msg = format!("Sysproxy::set_system_proxy failed: {}", e);
        app.emit(EVENT_TAURI_LOG, (1, msg.clone())).ok();
        return Err(anyhow::anyhow!(msg));
    }

    app.emit(EVENT_TAURI_LOG, (0, "System proxy unset successfully"))
        .ok();
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
        r#"ulimit -n 65535 && echo '{}' | sudo -S '{}' run -c '{}' --disable-color"#,
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

/// 停止TUN模式下的进程，并清理 `utun233` 接口的路由。
///
/// 配置写入时固定 `interface_name = "utun233"`，停止后枚举该接口的路由并逐条删除，
/// 再 down 掉接口，让 macOS configd 从物理网卡重建默认路由。
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

    std::thread::sleep(std::time::Duration::from_millis(500));

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

    let command = format!(
        "echo '{}' | sudo -S sh -c '\
            netstat -rn -f inet 2>/dev/null \
                | awk \"NR>4 && \\$NF==\\\"{iface}\\\"{{print \\$1}}\" \
                | while read dest; do route -q delete \"$dest\" 2>/dev/null; done; \
            netstat -rn -f inet6 2>/dev/null \
                | awk \"NR>4 && \\$NF==\\\"{iface}\\\"{{print \\$1}}\" \
                | while read dest; do route -q delete -inet6 \"$dest\" 2>/dev/null; done; \
            ifconfig {iface} down 2>/dev/null; \
            true'",
        password,
        iface = TUN_INTERFACE_NAME
    );
    log::info!("Removing routes for {} interface", TUN_INTERFACE_NAME);
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;

    // ZH: 重启 mDNSResponder 服务以清除缓存的 DNS 记录
    // EN: Restart the mDNSResponder service to clear cached DNS records
    let command = format!("echo '{}' | sudo -S killall -HUP mDNSResponder", password);
    log::info!(
        "Restart mDNSResponder with command : {}",
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
