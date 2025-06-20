use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_http::reqwest;

#[cfg(not(target_os = "windows"))]
use crate::privilege;
use crate::vpn::helper;
#[cfg(target_os = "linux")]
use crate::vpn::linux as platform_impl;
#[cfg(target_os = "macos")]
use crate::vpn::macos as platform_impl;
#[cfg(target_os = "windows")]
use crate::vpn::windows as platform_impl;
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
}

// 全局进程管理器
lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager {
        child: None,
        current_mode: None,
        tun_password: None,
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
            if pwd.is_empty() {
                return Err("Password is empty".to_string());
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
        println!("mode: {:?}", mode);
        Ok(String::new())
    }
}
/// 启动代理进程
#[tauri::command]
pub async fn start(app: tauri::AppHandle, path: String, mode: ProxyMode) -> Result<(), String> {
    // 启动前先停止已有进程
    stop(app.clone()).await?;
    let mode_clone = mode.clone();
    let password = get_password_for_mode(&mode).await?;

    let sidecar_command_opt = if mode == ProxyMode::SystemProxy {
        // 普通权限执行
        let cmd: Command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
        Some(cmd.args(["run", "-c", &path, "--disable-color"]))
    } else {
        let sidecar_path = helper::get_sidecar_path(Path::new("sing-box")).unwrap();
        platform_impl::create_privileged_command(&app, sidecar_path, path.clone(), password.clone())
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
        } // MutexGuard 在这里被释放

        // 根据当前模式执行不同的操作
        let proxy_result = if mode == ProxyMode::SystemProxy {
            // 设置系统代理
            platform_impl::set_proxy(&app).await
        } else {
            // 如果是 TUN 模式，取消系统代理
            platform_impl::unset_proxy(&app).await
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

                println!("[{:#?}]:{}", mode_clone, message);

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
                    eprintln!("Event handling error: {}", e);
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
        } // MutexGuard 在这里被释放

        // 睡眠 1s 等待进程启动
        std::thread::sleep(std::time::Duration::from_millis(1000));

        app.emit("status-changed", ()).unwrap();
    }

    Ok(())
}

pub async fn reset_system_proxy(app: &tauri::AppHandle) -> Result<(), String> {
    // 清理系统代理
    platform_impl::unset_proxy(app)
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
                    platform_impl::stop_tun_process(password)?;
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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
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
