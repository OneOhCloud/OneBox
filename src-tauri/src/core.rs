use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

#[cfg(not(target_os = "windows"))]
use crate::privilege;
use crate::state::{AppData, LogType};
use crate::vpn::{helper, EVENT_STATUS_CHANGED};
use crate::vpn::{PlatformVpnProxy, VpnProxy};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// 获取当天日期字符串（格式：YYYY-MM-DD）
fn today_date_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Howard Hinnant's algorithm: Unix days -> civil date (UTC)
    let z = secs as i64 / 86400 + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// 清理超过 keep_days 天的 sing-box 日志文件
fn cleanup_old_singbox_logs(log_dir: &Path, keep_days: u64) {
    let entries = match std::fs::read_dir(log_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(keep_days * 86400);

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with("sing-box-") && name_str.ends_with(".log") {
            if let Ok(meta) = entry.metadata() {
                let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                    log::info!("Removed old sing-box log: {}", name_str);
                }
            }
        }
    }
}

/// 创建 sing-box 专用日志文件写入器（按天轮转，保留 7 天）
fn create_singbox_log_writer(app: &AppHandle) -> Option<std::fs::File> {
    let log_dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&log_dir).ok()?;

    // 清理 7 天前的旧日志
    cleanup_old_singbox_logs(&log_dir, 7);

    let date = today_date_string();
    let log_path = log_dir.join(format!("sing-box-{}.log", date));
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| log::error!("Failed to open {}: {}", log_path.display(), e))
        .ok()
}

/// 向 sing-box 日志文件写入一行
fn write_singbox_log(writer: &mut Option<std::fs::File>, line: &str) {
    if let Some(ref mut file) = writer {
        let _ = writeln!(file, "{}", line);
    }
}

/// 代理模式
#[derive(Clone, Default, PartialEq, Serialize, Deserialize, Debug)]
pub enum ProxyMode {
    #[default]
    SystemProxy,
    TunProxy,
}

/// 进程管理器，记录当前代理进程及模式
struct ProcessManager {
    child: Option<CommandChild>,
    mode: Option<Arc<ProxyMode>>,      // 使用 Arc 避免 clone
    tun_password: Option<Arc<String>>, // 使用 Arc 避免 clone
    config_path: Option<Arc<String>>,  // 使用 Arc 避免 clone
    is_stopping: bool,                 // 标记是否正在执行stop操作
    // Watchdog 主动发起重启时置 true，防止 handle_process_termination 误清状态
    #[cfg(target_os = "macos")]
    bypass_router_restarting: bool,
    #[cfg(target_os = "macos")]
    bypass_router_watchdog_abort: Option<tokio::task::AbortHandle>,
}

// 全局进程管理器
lazy_static! {
    static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> = Arc::new(Mutex::new(ProcessManager {
        child: None,
        mode: None,
        tun_password: None,
        config_path: None,
        is_stopping: false,
        #[cfg(target_os = "macos")]
        bypass_router_restarting: false,
        #[cfg(target_os = "macos")]
        bypass_router_watchdog_abort: None,
    }));
}

/// 启动 sing-box 进程监控任务。
///
/// 将 rx 事件循环放入独立 tokio 任务，避免阻塞调用方。
/// 此函数本身是同步的（无 await），因此调用方的 Send 约束不受影响。
fn spawn_process_monitor(
    app: tauri::AppHandle,
    mut rx: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
    mode: Arc<ProxyMode>,
) {
    let mut singbox_log = create_singbox_log_writer(&app);
    tokio::spawn(async move {
        let mut terminated = false;
        let app_status_data = app.state::<AppData>();

        while let Some(event) = rx.recv().await {
            if terminated {
                if let tauri_plugin_shell::process::CommandEvent::Stdout(line)
                | tauri_plugin_shell::process::CommandEvent::Stderr(line) = event
                {
                    let line_str = String::from_utf8_lossy(&line);
                    write_singbox_log(&mut singbox_log, &line_str);
                }
                continue;
            }
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    write_singbox_log(&mut singbox_log, &line_str);
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    write_singbox_log(&mut singbox_log, &line_str);
                    app_status_data.write(line_str.to_string(), LogType::Info);
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    log::error!("sing-box process error: {}", err);
                    write_singbox_log(&mut singbox_log, &format!("[ERROR] {}", err));
                    app_status_data.write(err.to_string(), LogType::Error);
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    terminated = true;
                    log::info!(
                        "sing-box process terminated with exit code: {:?}",
                        payload.code
                    );
                    // Windows stop 操作会使进程以 exit code 1 退出，重写为 0 避免误报
                    let adjusted_payload = {
                        #[cfg(target_os = "windows")]
                        {
                            let is_stopping = {
                                let manager =
                                    PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                                manager.is_stopping
                            };
                            if is_stopping && payload.code == Some(1) {
                                tauri_plugin_shell::process::TerminatedPayload {
                                    code: Some(0),
                                    signal: payload.signal,
                                }
                            } else {
                                payload
                            }
                        }
                        #[cfg(not(target_os = "windows"))]
                        payload
                    };
                    handle_process_termination(&app, &mode, adjusted_payload).await;
                }
                _ => {}
            }
        }
    });
}

/// watchdog 重启 sing-box 的内部函数（macOS 专用，Send-safe）。
///
/// 跳过 keychain 读取和系统代理切换（均为非 Send 的异步调用），
/// 直接使用已存的 password/path 重新拉起进程。
#[cfg(target_os = "macos")]
async fn restart_tun_send_safe(
    app: tauri::AppHandle,
    path: Arc<String>,
    password: Arc<String>,
) -> Result<(), String> {
    let sidecar_path = helper::get_sidecar_path(Path::new("sing-box"))
        .map_err(|e| e.to_string())?;

    // create_privileged_command 会在 bypass_router 启用时重新执行 sysctl ip.forwarding=1
    let cmd = PlatformVpnProxy::create_privileged_command(
        &app,
        sidecar_path,
        path.as_ref().clone(),
        password.as_ref().clone(),
    )
    .ok_or_else(|| "create_privileged_command returned None".to_string())?;

    let (rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    let process_mode = Arc::new(ProxyMode::TunProxy);
    spawn_process_monitor(app.clone(), rx, Arc::clone(&process_mode));

    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
        manager.mode = Some(process_mode);
        manager.config_path = Some(Arc::clone(&path));
        manager.tun_password = Some(Arc::clone(&password));
        manager.child = Some(child);
        manager.is_stopping = false;
    }

    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    app.emit(EVENT_STATUS_CHANGED, ()).ok();

    Ok(())
}

/// 旁路由模式定时重启间隔（4 小时）。
/// sing-box 的 auto_detect_interface 会在物理网卡事件（睡眠/唤醒、DHCP 续租）时
/// 更新路由表，长时间运行可能导致路由表状态污染，引起局域网其他设备无法上网。
/// 定时重启可清除 sing-box 的路由表状态，恢复正常转发。
#[cfg(target_os = "macos")]
const BYPASS_ROUTER_RESTART_INTERVAL: std::time::Duration =
    std::time::Duration::from_secs(4 * 3600);

/// 旁路由模式定时重启 watchdog（loop 驱动，Send-safe）。
///
/// 每隔 BYPASS_ROUTER_RESTART_INTERVAL 停止并重新启动 sing-box，
/// 清除 auto_detect_interface 引起的路由表状态污染。
/// 由 stop() 或 handle_process_termination() 通过 bypass_router_watchdog_abort 取消。
#[cfg(target_os = "macos")]
async fn bypass_router_watchdog(
    app: tauri::AppHandle,
    password: Arc<String>,
    path: Arc<String>,
) {
    loop {
        tokio::time::sleep(BYPASS_ROUTER_RESTART_INTERVAL).await;

        // 检查是否仍处于 TUN 模式（用户手动停止时 abort 会在 sleep 处取消，
        // 此处作为防御性检查）
        let still_tun = {
            let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager
                .mode
                .as_ref()
                .map(|m| **m == ProxyMode::TunProxy)
                .unwrap_or(false)
        };

        if !still_tun {
            log::info!("[bypass_router_watchdog] TUN mode no longer active, exiting");
            return;
        }

        log::info!(
            "[bypass_router_watchdog] Scheduled restart after {}h to refresh routing table",
            BYPASS_ROUTER_RESTART_INTERVAL.as_secs() / 3600
        );

        // 标记 watchdog 主动重启，防止 handle_process_termination 清除进程状态
        {
            let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting = true;
        }

        if let Err(e) = PlatformVpnProxy::stop_tun_process(password.as_str()) {
            log::error!("[bypass_router_watchdog] stop_tun_process failed: {}", e);
            let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting = false;
            continue; // 下一个间隔重试
        }

        // 等待 TUN 接口和路由条目完全释放
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        {
            let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting = false;
        }

        // 重启（Send-safe：不调用 start，规避 macOS keychain/代理 API 的非 Send 约束）
        if let Err(e) =
            restart_tun_send_safe(app.clone(), Arc::clone(&path), Arc::clone(&password)).await
        {
            log::error!("[bypass_router_watchdog] restart failed: {}", e);
            // 继续 loop，下一个间隔重试
        }
    }
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
        let (rx, child) = sidecar_command.spawn().map_err(|e| {
            log::error!("Failed to spawn sidecar command: {}", e);
            e.to_string()
        })?;
        spawn_process_monitor(app.clone(), rx, Arc::new(mode.clone()));
        Some(child)
    } else {
        None
    };

    // 更新进程管理器状态；提前构造 Arc 供 watchdog 直接使用，避免写入后再读回
    let tun_password_arc = if !is_system_proxy {
        Some(Arc::new(password))
    } else {
        None
    };
    let config_path_arc = Arc::new(path);
    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Mutex lock error during process setup: {:?}", e);
            e.into_inner()
        });
        manager.mode = Some(Arc::new(mode.clone()));
        manager.config_path = Some(Arc::clone(&config_path_arc));
        manager.tun_password = tun_password_arc.clone();
        manager.child = child_opt;
        manager.is_stopping = false;
    }

    // 旁路由模式：启动定时重启 watchdog（仅 macOS）
    #[cfg(target_os = "macos")]
    if matches!(mode, ProxyMode::TunProxy) {
        use tauri_plugin_store::StoreExt;
        let bypass_router_enabled = app
            .get_store("settings.json")
            .and_then(|store| store.get("enable_bypass_router_key"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if bypass_router_enabled {
            if let Some(pw) = tun_password_arc {
                let pa = Arc::clone(&config_path_arc);
                // 终止旧 watchdog，防止重叠
                {
                    let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(abort) = manager.bypass_router_watchdog_abort.take() {
                        abort.abort();
                    }
                }
                let task = tokio::spawn(bypass_router_watchdog(app.clone(), pw, pa));
                {
                    let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                    manager.bypass_router_watchdog_abort = Some(task.abort_handle());
                    log::info!(
                        "[bypass_router_watchdog] Started, next restart in {}h",
                        BYPASS_ROUTER_RESTART_INTERVAL.as_secs() / 3600
                    );
                }
            }
        }
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
    // watchdog 主动发起重启时，sing-box 的退出是预期行为，跳过清理
    // 由 watchdog 自行调用 start() 完成状态重建
    #[cfg(target_os = "macos")]
    {
        let is_watchdog_restart = {
            let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting
        };
        if is_watchdog_restart {
            log::info!(
                "[handle_process_termination] bypass_router_watchdog restart in progress, skipping cleanup"
            );
            return;
        }
    }

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
            manager.is_stopping = false;
            // sing-box 意外退出时终止 watchdog，避免其在进程已停止后无效重启
            #[cfg(target_os = "macos")]
            if let Some(abort) = manager.bypass_router_watchdog_abort.take() {
                abort.abort();
            }
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

    // 设置停止标志
    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Mutex lock error during stop flag setting: {:?}", e);
            e.into_inner()
        });
        manager.is_stopping = true;
    }

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
        manager.is_stopping = false;
        // 用户主动停止时终止 watchdog
        #[cfg(target_os = "macos")]
        {
            if let Some(abort) = manager.bypass_router_watchdog_abort.take() {
                abort.abort();
            }
            manager.bypass_router_restarting = false;
        }
    }

    log::info!("Proxy process stopped");

    app.emit(EVENT_STATUS_CHANGED, ()).ok();
    Ok(())
}

/// 判断代理进程是否运行中
#[tauri::command]
pub async fn is_running(app: AppHandle, secret: String) -> bool {
    use crate::state::AppData;
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let app_data = app.state::<AppData>();
    app_data.set_clash_secret(Some(secret.clone()));

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

/// 获取当前运行中的代理配置（模式 + 配置路径），用于睡眠前保存恢复状态
#[cfg(target_os = "macos")]
pub fn get_running_config() -> Option<(ProxyMode, String)> {
    let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    match (manager.mode.as_ref(), manager.config_path.as_ref()) {
        (Some(mode), Some(path)) => Some(((**mode).clone(), (**path).clone())),
        _ => None,
    }
}

// 重载配置
#[tauri::command]
#[allow(unused_variables)]
pub async fn reload_config(app: tauri::AppHandle, is_tun: bool) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::process::Command;

        let (is_privileged, password_str, needs_proxy_reset) = {
            let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());

            // 验证模式匹配
            match (manager.mode.as_ref().map(|m| m.as_ref()), is_tun) {
                (Some(ProxyMode::TunProxy), true) => {}
                (Some(ProxyMode::SystemProxy), false) => {}
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

            let pwd = manager
                .tun_password
                .as_ref()
                .map(|p| p.as_str())
                .unwrap_or("")
                .to_string();

            // SystemProxy 模式需要在重载后重新设置代理
            let needs_reset = matches!(
                manager.mode.as_ref().map(|m| m.as_ref()),
                Some(ProxyMode::SystemProxy)
            );

            (is_tun, pwd, needs_reset)
        };

        log::info!("Reloading config using pkill -HUP sing-box");

        // 使用 pkill 发送 SIGHUP 信号（兼容原始代码行为）
        let output = if is_privileged && !password_str.is_empty() {
            // TUN 模式需要 sudo 权限
            let command = format!("echo '{}' | sudo -S pkill -HUP sing-box", password_str);
            Command::new("sh")
                .arg("-c")
                .arg(&command)
                .output()
                .map_err(|e| {
                    log::error!("Failed to execute sudo pkill command: {}", e);
                    format!("Failed to send SIGHUP with sudo: {}", e)
                })?
        } else {
            // System Proxy 模式直接发送信号
            Command::new("pkill")
                .arg("-HUP")
                .arg("sing-box")
                .output()
                .map_err(|e| {
                    log::error!("Failed to execute pkill command: {}", e);
                    format!("Failed to send SIGHUP: {}", e)
                })?
        };

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            log::error!("Failed to send SIGHUP: {}", error);
            return Err(format!("Failed to reload config: {}", error));
        }

        log::info!("SIGHUP sent successfully");

        // 如果是 SystemProxy 模式，需要等待进程重载后重新设置系统代理
        if needs_proxy_reset {
            log::info!("SystemProxy mode detected, waiting for reload and resetting proxy");

            // 等待进程重载配置（通常很快）
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            // 重新设置系统代理，确保代理配置生效
            if let Err(e) = PlatformVpnProxy::set_proxy(&app).await {
                log::error!("Failed to reset system proxy after reload: {}", e);
                return Err(format!("Config reloaded but failed to reset proxy: {}", e));
            }

            log::info!("System proxy reset successfully after reload");
        }

        Ok("Configuration reloaded successfully".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_today_date_string_format() {
        let date = today_date_string();
        // 格式应为 YYYY-MM-DD
        assert_eq!(date.len(), 10);
        assert_eq!(date.as_bytes()[4], b'-');
        assert_eq!(date.as_bytes()[7], b'-');

        let parts: Vec<&str> = date.split('-').collect();
        assert_eq!(parts.len(), 3);

        let year: i32 = parts[0].parse().expect("year should be a number");
        let month: i32 = parts[1].parse().expect("month should be a number");
        let day: i32 = parts[2].parse().expect("day should be a number");

        assert!(year >= 2024 && year <= 2100);
        assert!((1..=12).contains(&month));
        assert!((1..=31).contains(&day));
    }

    #[test]
    fn test_cleanup_old_singbox_logs_removes_old_files() {
        let tmp = TempDir::new().unwrap();

        // 创建一个"旧"日志文件，将修改时间设为 10 天前
        let old_file = tmp.path().join("sing-box-2020-01-01.log");
        fs::write(&old_file, "old log").unwrap();
        let ten_days_ago =
            std::time::SystemTime::now() - std::time::Duration::from_secs(10 * 86400);
        filetime::set_file_mtime(
            &old_file,
            filetime::FileTime::from_system_time(ten_days_ago),
        )
        .unwrap();

        // 创建一个"新"日志文件（刚创建，修改时间为现在）
        let new_file = tmp.path().join("sing-box-2099-01-01.log");
        fs::write(&new_file, "new log").unwrap();

        // 创建一个不匹配命名模式的文件，不应被清理
        let other_file = tmp.path().join("other.log");
        fs::write(&other_file, "other").unwrap();

        cleanup_old_singbox_logs(tmp.path(), 7);

        assert!(!old_file.exists(), "old log should be removed");
        assert!(new_file.exists(), "new log should be kept");
        assert!(other_file.exists(), "non-matching file should be kept");
    }

    #[test]
    fn test_cleanup_old_singbox_logs_nonexistent_dir() {
        // 不应 panic
        cleanup_old_singbox_logs(Path::new("/nonexistent/dir/abc123"), 7);
    }

    #[test]
    fn test_write_singbox_log() {
        let tmp = TempDir::new().unwrap();
        let log_path = tmp.path().join("test.log");

        let mut writer = Some(
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .unwrap(),
        );

        write_singbox_log(&mut writer, "hello line 1");
        write_singbox_log(&mut writer, "hello line 2");

        // 确保 flush
        drop(writer);

        let content = fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "hello line 1");
        assert_eq!(lines[1], "hello line 2");
    }

    #[test]
    fn test_write_singbox_log_none_writer() {
        // writer 为 None 时不应 panic
        let mut writer: Option<std::fs::File> = None;
        write_singbox_log(&mut writer, "should not panic");
    }
}
