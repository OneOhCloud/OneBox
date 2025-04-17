use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use sysproxy::Sysproxy;
use tauri::utils::platform;
use tauri::Emitter;
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str =
    "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

#[derive(Default, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProxyMode {
    #[default]
    SystemProxy,
    TunProxy,
}

struct ProcessManager {
    child: Option<CommandChild>,
    current_mode: Option<ProxyMode>,
}

#[derive(Clone)]
#[cfg(not(target_os = "windows"))]
struct ProxyConfig {
    host: String,
    port: u16,
    bypass: String,
}

#[cfg(not(target_os = "windows"))]
impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: String::from("127.0.0.1"),
            port: 5678,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}

lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager {
        child: None,
        current_mode: None,
    }));
}

async fn set_proxy() -> anyhow::Result<()> {
    #[cfg(not(target_os = "windows"))]
    {
        let config = ProxyConfig::default();
        let sys: Sysproxy = Sysproxy {
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
        anyhow::bail!("System proxy is not supported on Windows")
    }
}

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

#[tauri::command]
pub fn stop() -> Result<(), String> {
    let mut manager = PROCESS_MANAGER.lock().unwrap();

    // 根据当前模式执行清理操作
    if let Some(mode) = &manager.current_mode {
        match mode {
            ProxyMode::SystemProxy => {
                // 清理系统代理设置
                let mut sysproxy: Sysproxy =
                    Sysproxy::get_system_proxy().map_err(|e| e.to_string())?;
                sysproxy.enable = false;

                sysproxy.set_system_proxy().map_err(|e| e.to_string())?;
            }
            ProxyMode::TunProxy => {
                // 清理系统代理设置
                let mut sysproxy: Sysproxy =
                    Sysproxy::get_system_proxy().map_err(|e| e.to_string())?;
                sysproxy.enable = false;

                sysproxy.set_system_proxy().map_err(|e| e.to_string())?;
            }
        }
    }

    // 停止进程
    if let Some(child) = manager.child.take() {
        child.kill().map_err(|e| e.to_string())?;
    }

    // 清理模式状态
    manager.current_mode = None;

    Ok(())
}

fn get_sidecar_path(program: &Path) -> Result<String, anyhow::Error> {
    match platform::current_exe()?.parent() {
        #[cfg(windows)]
        Some(exe_dir) => Ok(exe_dir
            .join(command)
            .with_extension("exe")
            .to_string_lossy()
            .into_owned()),
        #[cfg(not(windows))]
        Some(exe_dir) => Ok(exe_dir.join(program).to_string_lossy().into_owned()),
        None => Err(anyhow::anyhow!("Failed to get the executable directory")),
    }
}

#[tauri::command]
pub async fn start(app: tauri::AppHandle, path: String, mode: ProxyMode) -> Result<(), String> {
    let _ = stop()?;
    let sidecar_command: Command;

    if mode == ProxyMode::TunProxy {
        let sidecar_path = get_sidecar_path(Path::new("sing-box")).unwrap();
        let command = format!(
            r#"do shell script "sudo '{}' run -c '{}'" with administrator privileges"#,
            sidecar_path.escape_default(),
            path.escape_default()
        );

        println!("Starting sidecar command: {}", command);
        sidecar_command = app.shell().command("osascript").args(vec!["-e", &command]);
    } else {
        let _command: Command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;

        sidecar_command = _command.args(["run", "-c", &path]);
    }

    let (mut rx, child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

    if mode == ProxyMode::SystemProxy {
        if let Err(e) = set_proxy().await {
            stop()?;
            return Err(e.to_string());
        }
    } else {
        // 清理系统代理设置
        let mut sysproxy: Sysproxy = Sysproxy::get_system_proxy().map_err(|e| e.to_string())?;
        sysproxy.enable = false;

        sysproxy.set_system_proxy().map_err(|e| e.to_string())?;
    }

    PROCESS_MANAGER.lock().unwrap().child = Some(child);
    PROCESS_MANAGER.lock().unwrap().current_mode = Some(mode);

    let process_manager = PROCESS_MANAGER.clone();

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

#[tauri::command]
pub async fn is_running() -> bool {
    let manager = PROCESS_MANAGER.lock().unwrap();
    manager.child.is_some()
}
