use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_http::reqwest;

#[cfg(not(target_os = "windows"))]
use crate::privilege;
use crate::vpn::helper;
use crate::vpn::{PlatformVpnProxy, VpnProxy};
use tauri::Emitter;
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// 代理模式
#[derive(Default, Clone, PartialEq, Serialize, Deserialize, Debug)]
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
    config_path: Option<String>,  // 记录配置文件路径
}

// 全局进程管理器
lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager {
        child: None,
        current_mode: None,
        tun_password: None,
        config_path: None,
    }));
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

async fn get_password_for_mode(mode: &ProxyMode) -> Result<String, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        if *mode == ProxyMode::TunProxy {
            let pwd = privilege::get_privilege_password_from_keyring().await;
            // 如果密码为空，返回特殊错误标识，而不是直接失败
            if pwd.is_empty() {
                return Err("REQUIRE_PRIVILEGE".to_string());
            }
            Ok(pwd)
        } else {
            // 普通权限执行, 不需要密码
            Ok(String::new())
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 无论是 TUN 模式还是系统代理模式，Windows 都不需要密码
        log::info!("mode: {:?}", mode);
        Ok(String::new())
    }
}
/// 启动代理进程
#[tauri::command]
pub async fn start(app: tauri::AppHandle, path: String, mode: ProxyMode) -> Result<(), String> {
    // 启动前先停止已有进程
    stop(app.clone()).await?;
    let mode_clone = mode.clone();

    // 检查是否需要权限验证
    let password = match get_password_for_mode(&mode).await {
        Ok(pwd) => pwd,
        Err(err) if err == "REQUIRE_PRIVILEGE" => {
            return Err("REQUIRE_PRIVILEGE".to_string());
        }
        Err(err) => return Err(err),
    };

    let sidecar_command_opt = if mode == ProxyMode::SystemProxy {
        // 普通权限执行
        let cmd: Command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
        Some(cmd.args(["run", "-c", &path, "--disable-color"]))
    } else {
        let sidecar_path = helper::get_sidecar_path(Path::new("sing-box")).unwrap();
        PlatformVpnProxy::create_privileged_command(
            &app,
            sidecar_path,
            path.clone(),
            password.clone(),
        )
    };

    if let Some(sidecar_command) = sidecar_command_opt {
        let (mut rx, child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

        // 临时存储密码，稍后再设置到 manager
        let tun_password = if mode == ProxyMode::TunProxy {
            Some(password.clone())
        } else {
            None
        };

        // 保存子进程，但不要在异步操作中持有 mutex guard
        {
            let mut manager = match PROCESS_MANAGER.lock() {
                Ok(m) => m,
                Err(e) => e.into_inner(),
            };

            if let Some(pass) = &tun_password {
                manager.tun_password = Some(pass.clone());
            }
            manager.child = Some(child);
            manager.config_path = Some(path.clone());
        } // MutexGuard 在这里被释放

        // 根据当前模式执行不同的操作
        let proxy_result = if mode == ProxyMode::SystemProxy {
            // 设置系统代理
            PlatformVpnProxy::set_proxy(&app).await
        } else {
            // 如果是 TUN 模式，取消系统代理
            PlatformVpnProxy::unset_proxy(&app).await
        };

        // 如果设置代理失败，清理进程并返回错误
        if let Err(e) = proxy_result {
            // 清理子进程
            let mut manager = match PROCESS_MANAGER.lock() {
                Ok(m) => m,
                Err(e) => e.into_inner(),
            };

            if let Some(child) = manager.child.take() {
                let _ = child.kill(); // 忽略可能的错误
            }
            manager.tun_password = None;
            return Err(e.to_string());
        }

        // 只有在所有操作都成功后才设置当前模式
        {
            let mut manager = match PROCESS_MANAGER.lock() {
                Ok(m) => m,
                Err(e) => e.into_inner(),
            };
            manager.current_mode = Some(mode);
        } // MutexGuard 在这里被释放

        let process_manager = PROCESS_MANAGER.clone();
        let app_clone = app.clone();
        // 后台异步处理进程事件
        tauri::async_runtime::spawn(async move {
            let handle_event = |event: CommandEvent| {
                let message = match &event {
                    CommandEvent::Stdout(line) => String::from_utf8_lossy(line.trim_ascii()),
                    CommandEvent::Stderr(line) => String::from_utf8_lossy(line.trim_ascii()),
                    CommandEvent::Terminated(status) => {
                        if let Ok(mut manager) = process_manager.lock() {
                            manager.child = None;
                        } else if let Err(e) = process_manager.lock() {
                            e.into_inner().child = None;
                        }

                        let msg = format!("Process terminated with status: {:?}", status);
                        app_clone.emit("core_backend", &msg).unwrap();
                        std::borrow::Cow::Owned(msg)
                    }
                    _ => return Ok(()),
                };

                log::debug!("[{:#?}]:{}", mode_clone, message);

                if message.contains("FATAL") {
                    // 如果是错误信息，弹出对话框
                    app_clone
                        .dialog()
                        .message(message.clone())
                        .kind(MessageDialogKind::Error)
                        .title("Error")
                        .blocking_show();
                }

                app_clone
                    .emit("core_backend", Some(message))
                    .map_err(|e| e.to_string())
            };

            while let Some(event) = rx.recv().await {
                if let Err(e) = handle_event(event) {
                    log::error!("Event handling error: {}", e);
                    app_clone
                        .emit("core_backend", Some(format!("Event handling error: {}", e)))
                        .unwrap();
                }
            }
        });
        // 睡眠 1.5s 等待进程启动
        std::thread::sleep(std::time::Duration::from_millis(1500));
        app.emit("status-changed", ()).unwrap();
    } else {
        // Windows TUN 模式等不可管理进程场景
        {
            let mut manager = match PROCESS_MANAGER.lock() {
                Ok(m) => m,
                Err(e) => e.into_inner(),
            };
            if mode == ProxyMode::TunProxy {
                manager.tun_password = Some(password);
            }
            manager.child = None;
            manager.current_mode = Some(mode);
            manager.config_path = Some(path.clone());
        } // MutexGuard 在这里被释放

        // 睡眠 1s 等待进程启动
        std::thread::sleep(std::time::Duration::from_millis(1000));

        app.emit("status-changed", ()).unwrap();
    }

    Ok(())
}

pub async fn reset_system_proxy(app: &tauri::AppHandle) -> Result<(), String> {
    // 清理系统代理
    PlatformVpnProxy::unset_proxy(app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 停止代理进程并清理代理设置
#[tauri::command]
pub async fn stop(app: tauri::AppHandle) -> Result<(), String> {
    // 在临时作用域中获取需要的信息，避免在await跨越时持有MutexGuard
    let (current_mode, tun_password, child_option) = {
        let mut manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };

        let mode = manager.current_mode.clone();
        let password = manager.tun_password.clone();
        let child = manager.child.take();

        // 提前清理状态，避免后续await时仍持有锁
        manager.current_mode = None;
        manager.tun_password = None;
        manager.config_path = None;

        (mode, password, child)
    }; // MutexGuard在此作用域结束时释放

    // 根据当前模式执行清理操作
    if let Some(mode) = &current_mode {
        match mode {
            ProxyMode::SystemProxy => {
                reset_system_proxy(&app).await.map_err(|e| e.to_string())?;
            }
            ProxyMode::TunProxy => {
                if let Some(password) = &tun_password {
                    PlatformVpnProxy::stop_tun_process(password)?;
                }
            }
        }
    }

    // 停止进程
    if let Some(child) = child_option {
        child.kill().map_err(|e| e.to_string())?;
    }

    // 睡眠 0.5 等待进程退出
    std::thread::sleep(std::time::Duration::from_millis(500));
    app.emit("status-changed", ()).unwrap();

    Ok(())
}

/// 判断代理进程是否运行中
#[tauri::command]
pub async fn is_running(secret: String) -> bool {
    use std::time::Duration;
    use tokio::net::TcpStream;
    use tokio::time::timeout;

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

    let res = client
        .get("http://127.0.0.1:9191/version")
        .header("Authorization", format!("Bearer {}", secret));
    let res = res.send().await;
    if let Ok(res) = res {
        if res.status() == 200 {
            return true;
        }
    }
    false
}

// 重载配置
#[tauri::command]
pub async fn reload_config(app: tauri::AppHandle) -> Result<String, String> {
    // 获取当前模式和密码信息
    let (current_mode, password) = {
        let manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };

        if manager.current_mode.is_none() {
            return Err("No running process found".to_string());
        }

        (
            manager.current_mode.clone(),
            manager.tun_password.clone().unwrap_or_default(),
        )
    };

    #[cfg(unix)]
    {
        use std::process::Command;

        let _ = &app; // 避免未使用警告

        // 检查是否是特权模式（TUN模式）
        let is_privileged = matches!(current_mode, Some(ProxyMode::TunProxy));

        // 直接查找 sing-box 进程并发送 HUP 信号
        let output = if is_privileged && !password.is_empty() {
            // 特权模式下使用 sudo 发送信号
            let command = "echo '{}' | sudo -S pkill -HUP sing-box";
            let command = command.replace("{}", &password);
            Command::new("sh")
                .arg("-c")
                .arg(&command)
                .output()
                .map_err(|e| format!("Failed to send SIGHUP signal with sudo: {}", e))?
        } else {
            // 普通模式下直接发送信号
            Command::new("pkill")
                .arg("-HUP")
                .arg("sing-box")
                .output()
                .map_err(|e| format!("Failed to send SIGHUP signal: {}", e))?
        };

        if output.status.success() {
            Ok("Configuration reloaded successfully".to_string())
        } else {
            let error = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to reload config: {}", error))
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows 平台不支持 SIGHUP 信号，需要通过重启进程来重载配置
        let (config_path, current_mode) = {
            let manager = match PROCESS_MANAGER.lock() {
                Ok(m) => m,
                Err(e) => e.into_inner(),
            };
            (manager.config_path.clone(), manager.current_mode.clone())
        };

        if let (Some(config_path), Some(mode)) = (config_path, current_mode) {
            // 先停止当前进程
            stop(app.clone()).await?;

            // 重新启动进程
            match start(app, config_path, mode).await {
                Ok(_) => {
                    Ok("Configuration reloaded successfully by restarting process".to_string())
                }
                Err(e) => Err(format!(
                    "Failed to reload config by restarting process: {}",
                    e
                )),
            }
        } else {
            Err("No running process found or missing configuration path".to_string())
        }
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = app; // 避免未使用警告
        Err("SIGHUP signal is not supported on this platform".to_string())
    }
}
