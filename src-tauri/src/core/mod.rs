mod log;
mod monitor;
mod watchdog;

use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::state::AppData;
use crate::engine::state_machine::{transition, Intent, EngineState, EngineStateCell};
#[cfg(not(target_os = "macos"))]
use crate::engine::helper;
use crate::engine::{readiness, EVENT_STATUS_CHANGED};
use crate::engine::{PlatformEngine, EngineManager};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

use self::monitor::spawn_process_monitor;
#[cfg(target_os = "macos")]
use self::watchdog::bypass_router_watchdog;
#[cfg(target_os = "windows")]
use self::watchdog::spawn_windows_service_watchdog;
#[cfg(target_os = "macos")]
use self::monitor::handle_process_termination;

// ── ProxyMode & ProcessManager ────────────────────────────────────────

#[derive(Clone, Default, PartialEq, Serialize, Deserialize, Debug)]
pub enum ProxyMode {
    #[default]
    SystemProxy,
    TunProxy,
}

pub(crate) struct ProcessManager {
    pub(crate) child: Option<CommandChild>,
    pub(crate) mode: Option<Arc<ProxyMode>>,
    pub(crate) config_path: Option<Arc<String>>,
    pub(crate) is_stopping: bool,
    #[cfg(target_os = "linux")]
    pub(crate) dns_override: Option<(String, String)>,
    #[cfg(target_os = "macos")]
    pub(crate) bypass_router_restarting: bool,
    #[cfg(target_os = "macos")]
    pub(crate) bypass_router_watchdog_abort: Option<tokio::task::AbortHandle>,
}

lazy_static! {
    pub(crate) static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> =
        Arc::new(Mutex::new(ProcessManager {
            child: None,
            mode: None,
            config_path: None,
            is_stopping: false,
            #[cfg(target_os = "linux")]
            dns_override: None,
            #[cfg(target_os = "macos")]
            bypass_router_restarting: false,
            #[cfg(target_os = "macos")]
            bypass_router_watchdog_abort: None,
        }));
}

// ── Tauri Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start(app: tauri::AppHandle, path: String, mode: ProxyMode) -> Result<(), String> {
    ::log::info!("Starting proxy process in mode: {:?}", mode);

    {
        let cur = app.state::<EngineStateCell>().snapshot();
        if !matches!(cur, EngineState::Idle { .. } | EngineState::Failed { .. }) {
            ::log::warn!(
                "[start] engine in {} state, forcing MarkIdle before restart",
                cur.kind()
            );
            let _ = transition(&app, Intent::MarkIdle);
        }
    }
    let mode_label = match mode {
        ProxyMode::TunProxy => "tun",
        ProxyMode::SystemProxy => "mixed",
    };
    if let Err(e) = transition(&app, Intent::Start { mode: mode_label.into() }) {
        return Err(format!("state transition rejected: {}", e));
    }
    let start_epoch = app.state::<EngineStateCell>().snapshot().epoch();

    let is_system_proxy = matches!(mode, ProxyMode::SystemProxy);

    let sidecar_result: Result<(Option<tauri_plugin_shell::process::Command>, bool), String> =
        if is_system_proxy {
            app.shell()
                .sidecar("sing-box")
                .map(|c| (Some(c.args(["run", "-c", &path, "--disable-color"])), true))
                .map_err(|e| {
                    ::log::error!("Failed to get sidecar command: {}", e);
                    e.to_string()
                })
        } else {
            #[cfg(target_os = "macos")]
            {
                tokio::task::spawn_blocking(crate::engine::macos::ensure_helper_installed)
                    .await
                    .map_err(|e| format!("helper install join error: {}", e))?
                    .map_err(|e| format!("helper install failed: {}", e))?;

                let app_c = app.clone();
                let path_c = path.clone();
                let _pid = tokio::task::spawn_blocking(move || {
                    crate::engine::macos::start_tun_via_helper(&app_c, &path_c)
                })
                .await
                .map_err(|e| format!("start_tun join error: {}", e))?
                .map_err(|e| format!("start_tun_via_helper failed: {}", e))?;

                Ok((None, false))
            }
            #[cfg(not(target_os = "macos"))]
            {
                #[cfg(target_os = "linux")]
                let dns_override_info: Option<(String, String)> = {
                    match crate::engine::linux::prepare_dns_override(&path) {
                        Ok(info) => {
                            let mut mgr =
                                PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                            mgr.dns_override = Some(info.clone());
                            Some(info)
                        }
                        Err(e) => {
                            ::log::warn!("[dns] prepare_dns_override failed: {}", e);
                            None
                        }
                    }
                };

                match helper::get_sidecar_path(Path::new("sing-box")) {
                    Ok(sidecar_path) => {
                        #[cfg(target_os = "linux")]
                        let cmd = crate::engine::linux::create_privileged_command(
                            &app,
                            sidecar_path,
                            path.clone(),
                            dns_override_info.as_ref(),
                        );
                        #[cfg(not(target_os = "linux"))]
                        let cmd = PlatformEngine::create_privileged_command(
                            &app,
                            sidecar_path,
                            path.clone(),
                        );
                        let is_managed = cmd.is_some();
                        Ok((cmd, is_managed))
                    }
                    Err(e) => {
                        ::log::error!("Failed to get sidecar path: {}", e);
                        Err(e.to_string())
                    }
                }
            }
        };
    let (sidecar_command_opt, is_managed) = match sidecar_result {
        Ok(v) => v,
        Err(e) => {
            let _ = transition(&app, Intent::Fail { reason: e.clone() });
            return Err(e);
        }
    };

    let child_opt = if let Some(sidecar_command) = sidecar_command_opt {
        ::log::info!("Spawning sidecar command");
        match sidecar_command.spawn() {
            Ok((rx, child)) => {
                spawn_process_monitor(app.clone(), rx, Arc::new(mode.clone()));
                Some(child)
            }
            Err(e) => {
                ::log::error!("Failed to spawn sidecar command: {}", e);
                let msg = e.to_string();
                let _ = transition(&app, Intent::Fail { reason: msg.clone() });
                return Err(msg);
            }
        }
    } else {
        None
    };

    #[cfg(target_os = "macos")]
    if !is_system_proxy {
        let mut exit_rx = crate::engine::macos::helper::subscribe_sing_box_exits();
        let exit_app = app.clone();
        let exit_mode = Arc::new(mode.clone());
        tokio::spawn(async move {
            if let Some(exit) = exit_rx.recv().await {
                ::log::info!(
                    "[helper-bridge] sing-box exit event pid={} code={}",
                    exit.pid,
                    exit.exit_code
                );
                let payload = tauri_plugin_shell::process::TerminatedPayload {
                    code: Some(exit.exit_code),
                    signal: None,
                };
                handle_process_termination(&exit_app, &exit_mode, payload).await;
            }
        });
    }

    let config_path_arc = Arc::new(path);
    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            ::log::error!("Mutex lock error during process setup: {:?}", e);
            e.into_inner()
        });
        manager.mode = Some(Arc::new(mode.clone()));
        manager.config_path = Some(Arc::clone(&config_path_arc));
        manager.child = child_opt;
        manager.is_stopping = false;
    }

    #[cfg(target_os = "macos")]
    if matches!(mode, ProxyMode::TunProxy) {
        use tauri_plugin_store::StoreExt;
        let bypass_router_enabled = app
            .get_store("settings.json")
            .and_then(|store| store.get("enable_bypass_router_key"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if bypass_router_enabled {
            let pa = Arc::clone(&config_path_arc);
            {
                let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(abort) = manager.bypass_router_watchdog_abort.take() {
                    abort.abort();
                }
            }
            let task = tokio::spawn(bypass_router_watchdog(app.clone(), pa));
            {
                let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                manager.bypass_router_watchdog_abort = Some(task.abort_handle());
                ::log::info!(
                    "[bypass_router_watchdog] Started, next restart in {}h",
                    watchdog::BYPASS_ROUTER_RESTART_INTERVAL.as_secs() / 3600
                );
            }
        }
    }

    let proxy_result = if is_system_proxy {
        PlatformEngine::set_proxy(&app).await
    } else {
        PlatformEngine::unset_proxy(&app).await
    };

    if let Err(e) = proxy_result {
        let msg = e.to_string();
        ::log::error!("Failed to set proxy: {}", msg);
        stop(app.clone()).await.ok();
        let _ = transition(&app, Intent::Fail { reason: msg.clone() });
        return Err(msg);
    }

    let wait_time = if is_managed { 1500 } else { 1000 };
    tokio::time::sleep(tokio::time::Duration::from_millis(wait_time)).await;

    ::log::info!("Proxy process spawn returned; handing off to readiness prober");
    readiness::spawn(app.clone(), start_epoch);

    #[cfg(target_os = "windows")]
    if matches!(mode, ProxyMode::TunProxy) {
        spawn_windows_service_watchdog(app.clone(), Arc::new(mode.clone()), start_epoch);
    }

    Ok(())
}

#[tauri::command]
pub async fn stop(app: tauri::AppHandle) -> Result<(), String> {
    ::log::info!("Stopping proxy process");

    {
        let cur = app.state::<EngineStateCell>().snapshot();
        match cur {
            EngineState::Running { .. } => {
                let _ = transition(&app, Intent::Stop);
            }
            EngineState::Starting { .. } => {
                let _ = transition(&app, Intent::MarkIdle);
            }
            _ => {}
        }
    }

    let (mode, child) = {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            ::log::error!("Mutex lock error during stop: {:?}", e);
            e.into_inner()
        });
        manager.is_stopping = true;
        (manager.mode.clone(), manager.child.take())
    };

    if let Some(mode) = mode {
        match mode.as_ref() {
            ProxyMode::SystemProxy => {
                PlatformEngine::unset_proxy(&app).await.ok();

                #[cfg(unix)]
                if let Some(child) = child {
                    use libc::{kill, SIGTERM};
                    let pid = child.pid();
                    ::log::info!("[stop] Sending SIGTERM to process with PID: {}", pid);
                    if unsafe { kill(pid as i32, SIGTERM) } != 0 {
                        ::log::error!(
                            "[stop] Failed to send SIGTERM to PID {}: {}",
                            pid,
                            std::io::Error::last_os_error()
                        );
                    } else {
                        ::log::info!("[stop] SIGTERM sent successfully to PID: {}", pid);
                    }
                }

                #[cfg(not(unix))]
                if let Some(child) = child {
                    child.kill().map_err(|e| e.to_string())?;
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            ProxyMode::TunProxy => {
                #[cfg(target_os = "macos")]
                {
                    crate::engine::macos::stop_tun_process().map_err(|e| {
                        ::log::error!("Failed to stop TUN process: {}", e);
                        e
                    })?;
                }
                #[cfg(target_os = "linux")]
                {
                    let dns_info = {
                        let mgr = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                        mgr.dns_override.clone()
                    };
                    crate::engine::linux::stop_tun_and_restore_dns(dns_info.as_ref()).map_err(
                        |e| {
                            ::log::error!("Failed to stop TUN process: {}", e);
                            e
                        },
                    )?;
                }
                #[cfg(target_os = "windows")]
                {
                    PlatformEngine::stop_tun_process().map_err(|e| {
                        ::log::error!("Failed to stop TUN process: {}", e);
                        e
                    })?;
                }

                #[cfg(any(target_os = "windows", target_os = "linux"))]
                {
                    let _ = transition(&app, Intent::MarkIdle);
                }
            }
        }
    }

    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            ::log::error!("Mutex lock error during state cleanup: {:?}", e);
            e.into_inner()
        });
        manager.mode = None;
        manager.config_path = None;
        manager.is_stopping = false;
        #[cfg(target_os = "linux")]
        {
            manager.dns_override = None;
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(abort) = manager.bypass_router_watchdog_abort.take() {
                abort.abort();
            }
            manager.bypass_router_restarting = false;
        }
    }

    ::log::info!("Proxy process stopped");
    app.emit(EVENT_STATUS_CHANGED, ()).ok();
    Ok(())
}

#[tauri::command]
pub async fn is_running(app: AppHandle, secret: String) -> bool {
    let app_data = app.state::<AppData>();
    app_data.set_clash_secret(Some(secret));
    let state = app.state::<EngineStateCell>().snapshot();
    matches!(state, EngineState::Running { .. })
}

#[tauri::command]
pub fn get_engine_state(app: AppHandle) -> EngineState {
    app.state::<EngineStateCell>().snapshot()
}

#[tauri::command]
pub fn clear_engine_error(app: AppHandle) {
    let cur = app.state::<EngineStateCell>().snapshot();
    if matches!(cur, EngineState::Failed { .. }) {
        let _ = transition(&app, Intent::ClearFailure);
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[allow(dead_code)]
pub fn reapply_tun_dns_override_if_active() {
    let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    let is_tun = manager
        .mode
        .as_ref()
        .map(|m| matches!(**m, ProxyMode::TunProxy))
        .unwrap_or(false);
    if !is_tun {
        return;
    }
    let config_path = match manager.config_path.as_ref().cloned() {
        Some(c) => c,
        None => return,
    };
    drop(manager);

    ::log::info!("[dns] NetworkUp — re-applying TUN gateway DNS override");
    #[cfg(target_os = "macos")]
    if let Err(e) = crate::engine::macos::apply_system_dns_override(&config_path) {
        ::log::warn!("[dns] NetworkUp re-apply failed: {}", e);
    }
    #[cfg(target_os = "linux")]
    match crate::engine::linux::apply_system_dns_override(&config_path) {
        Ok(override_info) => {
            let mut mgr = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            mgr.dns_override = Some(override_info);
        }
        Err(e) => ::log::warn!("[dns] NetworkUp re-apply failed: {}", e),
    }
}

#[cfg(target_os = "windows")]
pub fn reapply_tun_dns_override_if_active() {}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn get_running_config() -> Option<(ProxyMode, String)> {
    let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    match (manager.mode.as_ref(), manager.config_path.as_ref()) {
        (Some(mode), Some(path)) => Some(((**mode).clone(), (**path).clone())),
        _ => None,
    }
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn reload_config(app: tauri::AppHandle, is_tun: bool) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::process::Command;

        let (is_privileged, needs_proxy_reset) = {
            let manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());

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

            let needs_reset = matches!(
                manager.mode.as_ref().map(|m| m.as_ref()),
                Some(ProxyMode::SystemProxy)
            );

            (is_tun, needs_reset)
        };

        ::log::info!("Reloading config");

        #[cfg(target_os = "macos")]
        if is_privileged {
            tokio::task::spawn_blocking(crate::engine::macos::helper::api::reload_sing_box)
                .await
                .map_err(|e| format!("reload join error: {}", e))?
                .map_err(|e| format!("helper reload_sing_box failed: {}", e))?;
            ::log::info!("SIGHUP sent via helper");
        } else {
            let output = Command::new("pkill")
                .arg("-HUP")
                .arg("sing-box")
                .output()
                .map_err(|e| format!("Failed to send SIGHUP: {}", e))?;
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to reload config: {}", error));
            }
            ::log::info!("SIGHUP sent via pkill");
        }

        #[cfg(target_os = "linux")]
        {
            let output = Command::new("pkexec")
                .args([crate::engine::linux::HELPER_PATH, "reload"])
                .output()
                .map_err(|e| format!("Failed to send SIGHUP via helper: {}", e))?;
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to reload config: {}", error));
            }
            ::log::info!("SIGHUP sent via helper");
        }

        if needs_proxy_reset {
            ::log::info!("SystemProxy mode detected, waiting for reload and resetting proxy");
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Err(e) = PlatformEngine::set_proxy(&app).await {
                ::log::error!("Failed to reset system proxy after reload: {}", e);
                return Err(format!("Config reloaded but failed to reset proxy: {}", e));
            }
            ::log::info!("System proxy reset successfully after reload");
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

        PlatformEngine::restart(sidecar_path, config_path);
        Ok("Configuration reload attempted by restarting process".to_string())
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        Err("SIGHUP signal is not supported on this platform".to_string())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::log::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    #[test]
    fn test_today_date_string_format() {
        let date = today_date_string();
        assert_eq!(date.len(), 10);
        assert_eq!(date.as_bytes()[4], b'-');
        assert_eq!(date.as_bytes()[7], b'-');

        let parts: Vec<&str> = date.split('-').collect();
        assert_eq!(parts.len(), 3);

        let year: i32 = parts[0].parse().expect("year should be a number");
        let month: i32 = parts[1].parse().expect("month should be a number");
        let day: i32 = parts[2].parse().expect("day should be a number");

        assert!((2024..=2100).contains(&year));
        assert!((1..=12).contains(&month));
        assert!((1..=31).contains(&day));
    }

    #[test]
    fn test_cleanup_old_singbox_logs_removes_old_files() {
        let tmp = TempDir::new().unwrap();

        let old_file = tmp.path().join("sing-box-2020-01-01.log");
        fs::write(&old_file, "old log").unwrap();
        let ten_days_ago =
            std::time::SystemTime::now() - std::time::Duration::from_secs(10 * 86400);
        filetime::set_file_mtime(
            &old_file,
            filetime::FileTime::from_system_time(ten_days_ago),
        )
        .unwrap();

        let new_file = tmp.path().join("sing-box-2099-01-01.log");
        fs::write(&new_file, "new log").unwrap();

        let other_file = tmp.path().join("other.log");
        fs::write(&other_file, "other").unwrap();

        cleanup_old_singbox_logs(tmp.path(), 7);

        assert!(!old_file.exists(), "old log should be removed");
        assert!(new_file.exists(), "new log should be kept");
        assert!(other_file.exists(), "non-matching file should be kept");
    }

    #[test]
    fn test_cleanup_old_singbox_logs_nonexistent_dir() {
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
        drop(writer);

        let content = fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "hello line 1");
        assert_eq!(lines[1], "hello line 2");
    }

    #[test]
    fn test_write_singbox_log_none_writer() {
        let mut writer: Option<std::fs::File> = None;
        write_singbox_log(&mut writer, "should not panic");
    }
}
