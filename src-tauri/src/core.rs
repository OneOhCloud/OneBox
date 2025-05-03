use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::utils::platform;
use tauri::Emitter;
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use sysproxy::Sysproxy;

// 默认绕过列表
#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str =
    "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

/// 代理模式
#[derive(Default, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProxyMode {
    #[default]
    SystemProxy,
    TunProxy,
}

/// 进程管理器，记录当前代理进程及模式
struct ProcessManager {
    child: Option<CommandChild>,
    current_mode: Option<ProxyMode>,
    tun_password: Option<String>, // 仅记录密码
}

/// 代理配置
#[derive(Clone)]
struct ProxyConfig {
    host: String,
    port: u16,
    bypass: String,
}

#[cfg(target_os = "macos")]
impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 5678,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}
#[cfg(target_os = "windows")]
impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 5678,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}

#[cfg(target_os = "linux")]
impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 5678,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}

// 全局进程管理器
lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager {
        child: None,
        current_mode: None,
        tun_password: None,
    }));
}

/// 设置系统代理
async fn set_proxy(_app: &tauri::AppHandle) -> anyhow::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
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
    #[cfg(target_os = "windows")]
    {
        let config = ProxyConfig::default();
        let sidecar_path = get_sidecar_path(Path::new("sysproxy"))?;
        let address = format!("{}:{}", config.host, config.port);

        let sidecar_command =
            _app.shell()
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
        println!("Proxy set to {}:{}", config.host, config.port);
        println!("Bypass list: {}", config.bypass);
        Ok(())
    }
}

/// 取消系统代理
async fn unset_proxy(_app: &tauri::AppHandle) -> anyhow::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        // 清理系统代理设置
        let mut sysproxy = Sysproxy::get_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
        sysproxy.enable = false;

        sysproxy
            .set_system_proxy()
            .map_err(|e| anyhow::anyhow!(e))?;
        println!("Proxy unset");
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let sidecar_path = get_sidecar_path(Path::new("sysproxy"))?;
        let sidecar_command = _app.shell().command(sidecar_path).args(["set", "1"]);

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
        println!("Proxy unset");
        Ok(())
    }
}

/// 获取 sing-box 版本
#[tauri::command]
pub async fn version(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
    let output = sidecar_command
        .arg("version")
        .output()
        .await
        .map_err(|e| e.to_string())?;
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

/// 停止代理进程并清理代理设置
#[tauri::command]
pub fn stop(app: tauri::AppHandle) -> Result<(), String> {
    let mut manager = PROCESS_MANAGER.lock().unwrap();

    // 根据当前模式执行清理操作
    if let Some(mode) = &manager.current_mode {
        match mode {
            ProxyMode::SystemProxy => {
                // 系统代理模式，清理系统代理
                tauri::async_runtime::block_on(unset_proxy(&app)).map_err(|e| e.to_string())?;
            }
            ProxyMode::TunProxy => {
                if matches!(
                    tauri_plugin_os::type_(),
                    tauri_plugin_os::OsType::Linux | tauri_plugin_os::OsType::Macos
                ) {
                    // 类 Unix 系统 使用 sudo + 密码杀死所有 sing-box 进程
                    if let Some(password) = &manager.tun_password {
                        let command = format!("echo '{}' | sudo -S pkill -9 -f sing-box", password);
                        println!("Executing command: {}", command);
                        std::process::Command::new("sh")
                            .arg("-c")
                            .arg(command)
                            .output()
                            .map_err(|e| e.to_string())?;
                    }
                } else if matches!(tauri_plugin_os::type_(), tauri_plugin_os::OsType::Windows) {
                    // Windows 系统，使用 taskkill 杀死所有 sing-box 进程
                    let command = "runas /trustlevel:0x40000 taskkill /F /IM sing-box.exe";
                    println!("Executing command: {}", command);
                    std::process::Command::new("cmd")
                        .arg("/C")
                        .arg(command)
                        .output()
                        .map_err(|e| e.to_string())?;
                } else {
                    panic!("Unsupported OS type for TUN mode");
                }
            }
        }
    }

    // 停止进程
    if let Some(child) = manager.child.take() {
        child.kill().map_err(|e| e.to_string())?;
    }

    // 清理状态
    manager.current_mode = None;
    manager.tun_password = None;
    app.emit("status-changed", ()).unwrap();

    Ok(())
}

/// 获取 sidecar 路径
fn get_sidecar_path(program: &Path) -> Result<String, anyhow::Error> {
    match platform::current_exe()?.parent() {
        #[cfg(windows)]
        Some(exe_dir) => Ok(exe_dir
            .join(program)
            .with_extension("exe")
            .to_string_lossy()
            .into_owned()),
        #[cfg(not(windows))]
        Some(exe_dir) => Ok(exe_dir.join(program).to_string_lossy().into_owned()),
        None => Err(anyhow::anyhow!("Failed to get the executable directory")),
    }
}

/// 启动代理进程
#[tauri::command]
pub async fn start(
    app: tauri::AppHandle,
    path: String,
    mode: ProxyMode,
    password: String,
) -> Result<(), String> {
    // 启动前先停止已有进程
    let _ = stop(app.clone())?;

    let sidecar_command: Command = if mode == ProxyMode::SystemProxy {
        // 普通权限执行
        let cmd: Command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
        cmd.args(["run", "-c", &path])
    } else {
        let sidecar_path = get_sidecar_path(Path::new("sing-box")).unwrap();
        if matches!(
            tauri_plugin_os::type_(),
            tauri_plugin_os::OsType::Linux | tauri_plugin_os::OsType::Macos
        ) {
            // 类 Unix 系统特权启动
            let command = format!(
                r#"echo '{}' | sudo -S '{}' run -c '{}'"#,
                password.escape_default(),
                sidecar_path.escape_default(),
                path.escape_default()
            );
            app.shell().command("sh").args(vec!["-c", &command])
        } else if matches!(tauri_plugin_os::type_(), tauri_plugin_os::OsType::Windows) {
            // Windows 平台特权启动
            let command = format!(
                r#"runas /trustlevel:0x40000 "{}" run -c "{}""#,
                sidecar_path.escape_default(),
                path.escape_default()
            );
            app.shell().command("cmd").args(vec!["/C", &command])
        } else {
            panic!("Unsupported OS type for TUN mode");
        }
    };

    let (mut rx, child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

    // 根据当前模式执行不同的操作
    if mode == ProxyMode::SystemProxy {
        // 设置系统代理
        if let Err(e) = set_proxy(&app).await {
            // 如果设置系统代理失败，杀死进程
            stop(app)?;
            return Err(e.to_string());
        }
    } else {
        // 如果是 TUN 模式，取消系统代理
        if let Err(e) = unset_proxy(&app).await {
            // 如果取消系统代理失败，杀死进程
            stop(app)?;
            return Err(e.to_string());
        }
    }

    let mut manager = PROCESS_MANAGER.lock().unwrap();

    if mode == ProxyMode::TunProxy {
        manager.tun_password = Some(password);
    }
    manager.child = Some(child);
    manager.current_mode = Some(mode);

    let process_manager = PROCESS_MANAGER.clone();

    app.emit("status-changed", ()).unwrap();

    // 后台异步处理进程事件
    tauri::async_runtime::spawn(async move {
        let handle_event = |event: CommandEvent| {
            let (level, message) = match &event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(line);
                    (
                        if matches!(&event, CommandEvent::Stdout(_)) {
                            "stdout"
                        } else {
                            "stderr"
                        },
                        format!("'{}'", line_str),
                    )
                }
                CommandEvent::Terminated(status) => {
                    if let Ok(mut manager) = process_manager.lock() {
                        manager.child = None;
                    }
                    (
                        "info",
                        format!("Process terminated with status: {:?}", status),
                    )
                }
                _ => return Ok(()),
            };

            println!("{}: {}", level, message);
            app.emit("core_backend", Some(message))
                .map_err(|e| e.to_string())
        };

        while let Some(event) = rx.recv().await {
            if let Err(e) = handle_event(event) {
                eprintln!("Event handling error: {}", e);
            }
        }
    });

    Ok(())
}

/// 判断代理进程是否运行中
#[tauri::command]
pub async fn is_running() -> bool {
    let manager = PROCESS_MANAGER.lock().unwrap();
    manager.child.is_some()
}
