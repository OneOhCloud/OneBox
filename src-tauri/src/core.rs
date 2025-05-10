use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri_plugin_http::reqwest;

use tauri::Emitter;
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::vpn::helper;
#[cfg(target_os = "linux")]
use crate::vpn::linux as platform_impl;
#[cfg(target_os = "macos")]
use crate::vpn::macos as platform_impl;
#[cfg(target_os = "windows")]
use crate::vpn::windows as platform_impl;

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
    println!("mode: {:?}", mode);

    let sidecar_command_opt = if mode == ProxyMode::SystemProxy {
        // 普通权限执行
        let cmd: Command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
        Some(cmd.args(["run", "-c", &path]))
    } else {
        let sidecar_path = helper::get_sidecar_path(Path::new("sing-box")).unwrap();
        platform_impl::create_privileged_command(&app, sidecar_path, path.clone(), password.clone())
    };

    if let Some(sidecar_command) = sidecar_command_opt {
        let (mut rx, child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

        // 根据当前模式执行不同的操作
        if mode == ProxyMode::SystemProxy {
            // 设置系统代理
            if let Err(e) = platform_impl::set_proxy(&app).await {
                // 如果设置系统代理失败，杀死进程
                stop(app.clone())?;
                return Err(e.to_string());
            }
        } else {
            // 如果是 TUN 模式，取消系统代理
            if let Err(e) = platform_impl::unset_proxy(&app).await {
                // 如果取消系统代理失败，杀死进程
                stop(app.clone())?;
                return Err(e.to_string());
            }
        }

        let mut manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };

        if mode == ProxyMode::TunProxy {
            manager.tun_password = Some(password);
        }
        manager.child = Some(child);
        manager.current_mode = Some(mode);

        let process_manager = PROCESS_MANAGER.clone();
        let app_clone = app.clone();
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
                        } else if let Err(e) = process_manager.lock() {
                            e.into_inner().child = None;
                        }
                        (
                            "info",
                            format!("Process terminated with status: {:?}", status),
                        )
                    }
                    _ => return Ok(()),
                };

                println!("{}: {}", level, message);

                app_clone
                    .emit("core_backend", Some(message))
                    .map_err(|e| e.to_string())
            };

            while let Some(event) = rx.recv().await {
                if let Err(e) = handle_event(event) {
                    eprintln!("Event handling error: {}", e);
                }
            }
        });
        // 睡眠 1.5s 等待进程启动
        std::thread::sleep(std::time::Duration::from_millis(1500));
        app.emit("status-changed", ()).unwrap();
    } else {
        // Windows TUN 模式等不可管理进程场景
        let mut manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };
        if mode == ProxyMode::TunProxy {
            manager.tun_password = Some(password);
        }
        manager.child = None;
        manager.current_mode = Some(mode);
        // 睡眠 1.5s 等待进程启动
        std::thread::sleep(std::time::Duration::from_millis(1500));

        app.emit("status-changed", ()).unwrap();
    }

    Ok(())
}

/// 停止代理进程并清理代理设置
#[tauri::command]
pub fn stop(app: tauri::AppHandle) -> Result<(), String> {
    let mut manager = match PROCESS_MANAGER.lock() {
        Ok(m) => m,
        Err(e) => e.into_inner(),
    };

    // 根据当前模式执行清理操作
    if let Some(mode) = &manager.current_mode {
        match mode {
            ProxyMode::SystemProxy => {
                // 系统代理模式，清理系统代理
                tauri::async_runtime::block_on(platform_impl::unset_proxy(&app))
                    .map_err(|e| e.to_string())?;
            }
            ProxyMode::TunProxy => {
                if let Some(password) = &manager.tun_password {
                    platform_impl::stop_tun_process(password)?;
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
    // 睡眠 0.5 等待进程退出
    std::thread::sleep(std::time::Duration::from_millis(500));
    app.emit("status-changed", ()).unwrap();

    Ok(())
}

/// 判断代理进程是否运行中
#[tauri::command]
pub async fn is_running() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .no_proxy()
        .build()
        .unwrap();

    let res = client.get("http://127.0.0.1:9191/version");
    let res = res.send().await;
    if let Ok(res) = res {
        if res.status() == 200 {
            return true;
        }
    }
    false
}
