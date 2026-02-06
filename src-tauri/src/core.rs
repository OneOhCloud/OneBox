use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_http::reqwest;

use crate::app_status::{AppData, LogType};
#[cfg(not(target_os = "windows"))]
use crate::privilege;
use crate::vpn::{helper, EVENT_STATUS_CHANGED};
use crate::vpn::{PlatformVpnProxy, VpnProxy};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// 代理模式
#[derive(Clone, PartialEq, Serialize, Deserialize, Debug)]
pub enum ProxyMode {
    SystemProxy,
    TunProxy,
}

impl Default for ProxyMode {
    fn default() -> Self {
        Self::SystemProxy
    }
}

/// 进程管理器，记录当前代理进程及模式
struct ProcessManager {
    child: Option<CommandChild>,
    mode: Option<Arc<ProxyMode>>,      // 使用 Arc 避免 clone
    tun_password: Option<Arc<String>>, // 使用 Arc 避免 clone
    config_path: Option<Arc<String>>,  // 使用 Arc 避免 clone
}

// 全局进程管理器
lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager {
        child: None,
        mode: None,
        tun_password: None,
        config_path: None,
    }));
}

async fn get_password_for_mode(mode: &ProxyMode) -> Result<String, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        if matches!(mode, ProxyMode::TunProxy) {
            let pwd = privilege::get_privilege_password_from_keyring().await;
            if pwd.is_empty() {
                return Err("REQUIRE_PRIVILEGE".to_string());
            }
            Ok(pwd)
        } else {
            Ok(String::new())
        }
    }

    #[cfg(target_os = "windows")]
    {
        log::info!("mode: {:?}", mode);
        Ok(String::new())
    }
}

/// 启动代理进程
#[tauri::command]
pub async fn start(app: tauri::AppHandle, path: String, mode: ProxyMode) -> Result<(), String> {
    log::info!("Starting proxy process in mode: {:?}", mode);

    // 检查是否需要权限验证
    let password = get_password_for_mode(&mode).await?;
    let is_system_proxy = matches!(mode, ProxyMode::SystemProxy);

    // 准备命令
    let (sidecar_command_opt, is_managed) = if is_system_proxy {
        let cmd = app
            .shell()
            .sidecar("sing-box")
            .map_err(|e| {
                log::error!("Failed to get sidecar command: {}", e);
                e.to_string()
            })?
            .args(["run", "-c", &path, "--disable-color"]);
        (Some(cmd), true)
    } else {
        let sidecar_path = helper::get_sidecar_path(Path::new("sing-box")).map_err(|e| {
            log::error!("Failed to get sidecar path: {}", e);
            e.to_string()
        })?;

        let cmd = PlatformVpnProxy::create_privileged_command(
            &app,
            sidecar_path,
            path.clone(),
            password.clone(),
        );
        let is_managed = cmd.is_some();
        (cmd, is_managed)
    };

    // 启动进程
    let child_opt = if let Some(sidecar_command) = sidecar_command_opt {
        log::info!("Spawning sidecar command");
        let (mut rx, child) = sidecar_command.spawn().map_err(|e| {
            log::error!("Failed to spawn sidecar command: {}", e);
            e.to_string()
        })?;

        // 使用 Arc 避免 clone
        let app_handle = app.clone();
        let process_mode = Arc::new(mode.clone());
        let mode_for_task = Arc::clone(&process_mode);

        // 监听子进程输出
        tokio::spawn(async move {
            let mut terminated = false;
            let app_status_data = app_handle.state::<AppData>();

            while let Some(event) = rx.recv().await {
                if terminated {
                    if let tauri_plugin_shell::process::CommandEvent::Stdout(line)
                    | tauri_plugin_shell::process::CommandEvent::Stderr(line) = event
                    {
                        log::info!(
                            "Post-terminate output: {:?}",
                            String::from_utf8_lossy(&line)
                        );
                    }
                    continue;
                }

                match event {
                    tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                        log::info!("sing-box stdout: {:?}", String::from_utf8_lossy(&line));
                    }
                    tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        print!("{}", line_str);
                        app_status_data.write(line_str.to_string(), LogType::Info);
                    }
                    tauri_plugin_shell::process::CommandEvent::Error(err) => {
                        log::error!("sing-box process error: {}", err);
                        app_status_data.write(err.to_string(), LogType::Error);
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                        terminated = true;
                        log::info!(
                            "sing-box process terminated with exit code: {:?}",
                            payload.code
                        );

                        handle_process_termination(&app_handle, &mode_for_task, payload).await;
                    }
                    _ => {}
                }
            }
        });
        Some(child)
    } else {
        None
    };

    // 更新进程管理器状态
    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Mutex lock error during process setup: {:?}", e);
            e.into_inner()
        });

        manager.mode = Some(Arc::new(mode.clone()));
        manager.config_path = Some(Arc::new(path));
        manager.tun_password = if !is_system_proxy {
            Some(Arc::new(password))
        } else {
            None
        };
        manager.child = child_opt;
    }

    // 设置或取消系统代理
    let proxy_result = if is_system_proxy {
        PlatformVpnProxy::set_proxy(&app).await
    } else {
        PlatformVpnProxy::unset_proxy(&app).await
    };

    if let Err(e) = proxy_result {
        stop(app).await.ok();
        log::error!("Failed to set proxy: {}", e);
        return Err(e.to_string());
    }

    // 等待进程启动
    let wait_time = if is_managed { 1500 } else { 1000 };
    tokio::time::sleep(tokio::time::Duration::from_millis(wait_time)).await;

    log::info!("Proxy process started successfully");
    app.emit(EVENT_STATUS_CHANGED, ()).ok();

    Ok(())
}

// 提取进程终止处理逻辑
async fn handle_process_termination(
    app_handle: &tauri::AppHandle,
    process_mode: &Arc<ProxyMode>,
    payload: tauri_plugin_shell::process::TerminatedPayload,
) {
    let should_cleanup = {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Failed to lock process manager: {:?}", e);
            e.into_inner()
        });

        // 检查模式是否匹配（比较值而不是指针）
        let matches = manager
            .mode
            .as_ref()
            .map(|m| **m == **process_mode)
            .unwrap_or(false);

        if matches {
            log::info!("Cleaning up resources after process termination");
            manager.child = None;
            manager.mode = None;
            manager.config_path = None;
            manager.tun_password = None;
        }
        matches
    };

    if !should_cleanup {
        log::info!("Process mode has changed, skipping cleanup");
        return;
    }

    // 清理系统代理设置
    if matches!(**process_mode, ProxyMode::SystemProxy) {
        if let Err(e) = PlatformVpnProxy::unset_proxy(app_handle).await {
            log::error!("Failed to unset proxy after process termination: {}", e);
        }
    }

    // 通知前端
    if let Err(e) = app_handle.emit(EVENT_STATUS_CHANGED, payload) {
        log::error!("Failed to emit status-changed event: {}", e);
    }
}

/// 停止代理进程并清理代理设置
#[tauri::command]
pub async fn stop(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("Stopping proxy process");

    let (mode, password, child) = {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Mutex lock error during stop: {:?}", e);
            e.into_inner()
        });

        (
            manager.mode.clone(),
            manager.tun_password.clone(),
            manager.child.take(),
        )
    };

    // 根据当前模式执行清理操作
    if let Some(mode) = mode {
        match mode.as_ref() {
            ProxyMode::SystemProxy => {
                PlatformVpnProxy::unset_proxy(&app).await.ok();

                #[cfg(unix)]
                if let Some(child) = child {
                    use libc::{kill, SIGTERM};
                    let pid = child.pid();
                    log::info!("[stop] Sending SIGTERM to process with PID: {}", pid);

                    if unsafe { kill(pid as i32, SIGTERM) } != 0 {
                        log::error!(
                            "[stop] Failed to send SIGTERM to PID {}: {}",
                            pid,
                            std::io::Error::last_os_error()
                        );
                    } else {
                        log::info!("[stop] SIGTERM sent successfully to PID: {}", pid);
                    }
                }

                #[cfg(not(unix))]
                if let Some(child) = child {
                    child.kill().map_err(|e| e.to_string())?;
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            ProxyMode::TunProxy => {
                if let Some(pwd) = password {
                    PlatformVpnProxy::stop_tun_process(&pwd).map_err(|e| {
                        log::error!("Failed to stop TUN process: {}", e);
                        e
                    })?;
                }
            }
        }
    }

    // 清理状态
    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Mutex lock error during state cleanup: {:?}", e);
            e.into_inner()
        });
        manager.mode = None;
        manager.tun_password = None;
        manager.config_path = None;
    }

    log::info!("Proxy process stopped");
    app.emit(EVENT_STATUS_CHANGED, ()).ok();
    Ok(())
}

/// 判断代理进程是否运行中
#[tauri::command]
pub async fn is_running(secret: String) -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    // 先快速检查端口是否开放
    if timeout(
        Duration::from_millis(100),
        TcpStream::connect("127.0.0.1:9191"),
    )
    .await
    .is_err()
    {
        return false;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .no_proxy()
        .build()
        .unwrap();

    client
        .get("http://127.0.0.1:9191/version")
        .header("Authorization", format!("Bearer {}", secret))
        .send()
        .await
        .map(|res| res.status() == 200)
        .unwrap_or(false)
}

// 重载配置
#[tauri::command]
pub async fn reload_config(is_tun: bool) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::process::Command;

        let (is_privileged, password_str) = {
            let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());

            match (manager.mode.as_ref().map(|m| m.as_ref()), is_tun) {
                (Some(ProxyMode::TunProxy), true) => {
                    let pwd = manager
                        .tun_password
                        .as_ref()
                        .map(|p| p.as_str())
                        .unwrap_or("")
                        .to_string();
                    (true, pwd)
                }
                (Some(ProxyMode::SystemProxy), false) => (false, String::new()),
                (Some(ProxyMode::TunProxy), false) => {
                    return Err("Current mode is TUN mode, not System Proxy mode".to_string());
                }
                (Some(ProxyMode::SystemProxy), true) => {
                    return Err("Current mode is System Proxy mode, not TUN mode".to_string());
                }
                (None, _) => {
                    return Err("No running process found".to_string());
                }
            }
        };

        let output = if is_privileged && !password_str.is_empty() {
            let command = format!("echo '{}' | sudo -S pkill -HUP sing-box", password_str);
            Command::new("sh")
                .arg("-c")
                .arg(&command)
                .output()
                .map_err(|e| format!("Failed to send SIGHUP signal with sudo: {}", e))?
        } else {
            Command::new("pkill")
                .arg("-HUP")
                .arg("sing-box")
                .output()
                .map_err(|e| format!("Failed to send SIGHUP signal: {}", e))?
        };

        if output.status.success() {
            Ok("Configuration reloaded successfully".to_string())
        } else {
            Err(format!(
                "Failed to reload config: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }

    #[cfg(target_os = "windows")]
    {
        let config_path = {
            let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager
                .config_path
                .as_ref()
                .map(|p| p.as_str().to_string())
                .unwrap_or_default()
        };

        let sidecar_path = helper::get_sidecar_path(Path::new("sing-box"))
            .map_err(|e| format!("Failed to get sidecar path: {}", e))?;

        PlatformVpnProxy::restart(sidecar_path, config_path);

        Ok("Configuration reload attempted by restarting process".to_string())
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        Err("SIGHUP signal is not supported on this platform".to_string())
    }
}
