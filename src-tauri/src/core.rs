use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri_plugin_http::reqwest;

#[cfg(not(target_os = "windows"))]
use crate::privilege;
use crate::vpn::helper;
use crate::vpn::{PlatformVpnProxy, VpnProxy};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;
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
    log::info!("Starting proxy process in mode: {:?}", mode);

    // 检查是否需要权限验证 (异步调用)
    let password = match get_password_for_mode(&mode).await {
        Ok(pwd) => pwd,
        Err(err) if err == "REQUIRE_PRIVILEGE" => return Err(err),
        Err(err) => {
            log::error!("Failed to get privilege password: {}", err);
            return Err(err);
        }
    };

    // 确定是否是受管理的进程（需要在后面使用等待时间）
    let is_managed_process;

    // 准备命令
    let sidecar_command_opt = if mode == ProxyMode::SystemProxy {
        // 普通权限执行
        is_managed_process = true;
        match app.shell().sidecar("sing-box") {
            Ok(cmd) => Some(cmd.args(["run", "-c", &path, "--disable-color"])),
            Err(e) => {
                log::error!("Failed to get sidecar command: {}", e);
                return Err(e.to_string());
            }
        }
    } else {
        // TUN模式执行
        match helper::get_sidecar_path(Path::new("sing-box")) {
            Ok(sidecar_path) => {
                let cmd = PlatformVpnProxy::create_privileged_command(
                    &app,
                    sidecar_path,
                    path.clone(),
                    password.clone(),
                );
                is_managed_process = cmd.is_some();
                cmd
            }
            Err(e) => {
                log::error!("Failed to get sidecar path: {}", e);
                return Err(e.to_string());
            }
        }
    };

    // 启动进程并获取子进程句柄（如果有）
    let child_opt = if let Some(sidecar_command) = sidecar_command_opt {
        log::info!("Spawning sidecar command");
        match sidecar_command.spawn() {
            Ok((mut rx, child)) => {
                // 为了在进程终止时能够清理资源，克隆必要的数据
                let app_handle = app.clone();
                let process_mode = mode.clone();

                // 启动一个任务来监听子进程输出
                tokio::spawn(async move {
                    let mut terminated = false;

                    while let Some(event) = rx.recv().await {
                        if terminated {
                            // 如果已经处理了终止事件，只记录其他事件但不再处理
                            match event {
                                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                    log::info!(
                                        "Post-terminate stdout: {:?}",
                                        String::from_utf8_lossy(&line)
                                    );
                                }
                                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                    log::error!(
                                        "Post-terminate stderr: {:?}",
                                        String::from_utf8_lossy(&line)
                                    );
                                }
                                _ => {}
                            }
                            continue;
                        }

                        match event {
                            tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                log::info!("Proxy stdout: {:?}", String::from_utf8_lossy(&line));
                            }

                            tauri_plugin_shell::process::CommandEvent::Error(err) => {
                                log::error!("Proxy process error: {}", err);
                            }
                            tauri_plugin_shell::process::CommandEvent::Terminated(exit_code) => {
                                terminated = true; // 标记为已处理终止事件
                                log::info!(
                                    "Proxy process terminated with exit code: {:?}",
                                    exit_code
                                );

                                // 清理资源
                                {
                                    let mut manager = match PROCESS_MANAGER.lock() {
                                        Ok(m) => m,
                                        Err(e) => {
                                            log::error!("Failed to lock process manager: {:?}", e);
                                            e.into_inner()
                                        }
                                    };

                                    // 只有当当前模式与启动时的模式匹配时才清理资源
                                    if manager.current_mode.as_ref() == Some(&process_mode) {
                                        log::info!(
                                            "Cleaning up resources after process termination"
                                        );
                                        manager.child = None;
                                        manager.current_mode = None;
                                        manager.config_path = None;
                                        manager.tun_password = None;

                                        // 如果是系统代理模式，则需要取消系统代理设置
                                        if process_mode == ProxyMode::SystemProxy {
                                            // 不能在同步代码块中异步调用，所以这里克隆并立即释放锁
                                            drop(manager);

                                            // 在异步块外清理代理设置
                                            let cleanup_app = app_handle.clone();
                                            tokio::spawn(async move {
                                                if let Err(e) =
                                                    PlatformVpnProxy::unset_proxy(&cleanup_app)
                                                        .await
                                                {
                                                    log::error!("Failed to unset proxy after process termination: {}", e);
                                                }

                                                // 通知前端状态已更改
                                                if let Err(e) =
                                                    cleanup_app.emit("status-changed", ())
                                                {
                                                    log::error!(
                                                        "Failed to emit status-changed event: {}",
                                                        e
                                                    );
                                                }
                                            });
                                        } else {
                                            // 对于非系统代理模式，直接通知前端
                                            drop(manager);
                                            if let Err(e) = app_handle.emit("status-changed", ()) {
                                                log::error!(
                                                    "Failed to emit status-changed event: {}",
                                                    e
                                                );
                                            }
                                        }
                                    } else {
                                        log::info!("Process mode has changed, skipping cleanup");
                                    }
                                } // 结束锁作用域
                            }
                            _ => {}
                        }
                    }
                });
                Some(child)
            }
            Err(e) => {
                log::error!("Failed to spawn sidecar command: {}", e);
                return Err(e.to_string());
            }
        }
    } else {
        None
    };

    // 更新进程管理器状态 (无异步操作)
    {
        let mut manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => {
                log::error!("Mutex lock error during process setup: {:?}", e);
                e.into_inner()
            }
        };

        manager.current_mode = Some(mode.clone());
        manager.config_path = Some(path.clone());
        manager.tun_password = if mode == ProxyMode::TunProxy {
            Some(password)
        } else {
            None
        };
        manager.child = child_opt;
    } // MutexGuard 在这里被释放

    // 根据模式设置或取消系统代理 (异步操作)
    let proxy_result = if mode == ProxyMode::SystemProxy {
        PlatformVpnProxy::set_proxy(&app).await
    } else {
        PlatformVpnProxy::unset_proxy(&app).await
    };

    // 处理代理设置结果
    if let Err(e) = proxy_result {
        // 清理子进程
        let mut manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => {
                log::error!("Mutex lock error during cleanup: {:?}", e);
                e.into_inner()
            }
        };

        if let Some(child) = manager.child.take() {
            log::info!("Killing child process due to proxy setup failure");
            #[cfg(unix)]
            {
                use libc::{kill, SIGTERM};
                let pid = child.pid();
                log::info!("Sending SIGTERM to process with PID: {}", pid);
                let res = unsafe { kill(pid as i32, SIGTERM) };
                if res != 0 {
                    log::error!(
                        "Failed to send SIGTERM to process with PID {}: {}",
                        pid,
                        std::io::Error::last_os_error()
                    );
                }
            }
            #[cfg(not(unix))]
            {
                // 非unix不能发信号, 只能 kill
                child.kill().map_err(|e| e.to_string())?;
            }
        }
        manager.current_mode = None;
        manager.config_path = None;
        manager.tun_password = None;

        log::error!("Failed to set proxy: {}", e);
        return Err(e.to_string());
    }

    // 等待进程启动
    let wait_time = if is_managed_process {
        std::time::Duration::from_millis(1500)
    } else {
        std::time::Duration::from_millis(1000)
    };

    std::thread::sleep(wait_time);

    log::info!("Proxy process started successfully");
    if let Err(e) = app.emit("status-changed", ()) {
        log::error!("Failed to emit status-changed event: {}", e);
    }

    Ok(())
}

/// 停止代理进程并清理代理设置
#[tauri::command]
pub async fn stop(app: tauri::AppHandle) -> Result<(), String> {
    // 在临时作用域中获取需要的信息，避免在await跨越时持有MutexGuard

    log::info!("Stopping proxy process");
    let (current_mode, tun_password, child_option) = {
        let mut manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => {
                log::error!("Mutex lock error during stop: {:?}", e);
                e.into_inner()
            }
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
                if let Err(e) = PlatformVpnProxy::unset_proxy(&app).await {
                    log::error!("Failed to unset system proxy: {}", e);
                }
            }
            ProxyMode::TunProxy => {
                if let Some(password) = &tun_password {
                    PlatformVpnProxy::stop_tun_process(password).map_err(|e| {
                        log::error!("Failed to stop TUN process: {}", e);
                        e
                    })?;
                }
            }
        }
    }

    // 停止进程

    #[cfg(unix)]
    {
        use libc::{kill, SIGTERM};
        if let Some(child) = child_option {
            let pid = child.pid();
            log::info!("Sending SIGTERM to process with PID: {}", pid);
            let res = unsafe { kill(pid as i32, SIGTERM) };
            if res != 0 {
                log::error!(
                    "Failed to send SIGTERM to process with PID {}: {}",
                    pid,
                    std::io::Error::last_os_error()
                );
            }
        } else {
            log::info!("No child process to terminate");
        }
    }
    #[cfg(not(unix))]
    {
        // 非unix不能发信号, 只能 kill
        if let Some(child) = child_option {
            child.kill().map_err(|e| e.to_string())?;
        }
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
pub async fn reload_config(app: tauri::AppHandle, is_tun: bool) -> Result<String, String> {
    // 获取当前模式和密码信息
    let (current_mode, password) = {
        let manager = match PROCESS_MANAGER.lock() {
            Ok(m) => m,
            Err(e) => e.into_inner(),
        };
        match manager.current_mode {
            Some(ProxyMode::TunProxy) if is_tun => (
                Some(ProxyMode::TunProxy),
                manager.tun_password.clone().unwrap_or_default(),
            ),
            Some(ProxyMode::SystemProxy) if !is_tun => (
                Some(ProxyMode::SystemProxy),
                manager.tun_password.clone().unwrap_or_default(),
            ),
            Some(ProxyMode::TunProxy) => {
                return Err("Current mode is not TUN mode".to_string());
            }
            Some(ProxyMode::SystemProxy) => {
                return Err("Current mode is not System Proxy mode".to_string());
            }
            None => {
                return Err("No running process found".to_string());
            }
        }
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

        let sidecar_path = helper::get_sidecar_path(Path::new("sing-box"))
            .map_err(|e| format!("Failed to get sidecar path: {}", e))?;
        PlatformVpnProxy::restart(sidecar_path, config_path.unwrap_or_default());
        Ok("Configuration reload attempted by restarting process".to_string())
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = app; // 避免未使用警告
        Err("SIGHUP signal is not supported on this platform".to_string())
    }
}
