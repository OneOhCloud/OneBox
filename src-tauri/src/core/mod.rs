mod log;
pub(crate) mod monitor;

use lazy_static::lazy_static;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::state::AppData;
use crate::engine::state_machine::{transition, Intent, EngineState, EngineStateCell};
use crate::engine::{readiness, EVENT_STATUS_CHANGED};
use crate::engine::{PlatformEngine, EngineManager};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;


// ── ProcessManager ────────────────────────────────────────────────────
//
// ProxyMode lives in `engine` since the mode is an engine-level concept;
// this module re-exports it so existing `core::ProxyMode` paths continue
// to work.
pub use crate::engine::ProxyMode;

pub(crate) struct ProcessManager {
    pub(crate) child: Option<CommandChild>,
    pub(crate) mode: Option<Arc<ProxyMode>>,
    pub(crate) config_path: Option<Arc<String>>,
    pub(crate) is_stopping: bool,
}

impl ProcessManager {
    /// Lock the global PROCESS_MANAGER, recovering from poison.
    pub(crate) fn acquire() -> std::sync::MutexGuard<'static, ProcessManager> {
        PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reset to idle defaults. Platform engines are expected to have
    /// already torn down their own private state (macOS bypass-router
    /// watchdog, Linux DNS-override stash, …) via `stop` or
    /// `on_process_terminated` before this runs.
    pub(crate) fn reset(&mut self) {
        self.child = None;
        self.mode = None;
        self.config_path = None;
        self.is_stopping = false;
    }
}

lazy_static! {
    pub(crate) static ref PROCESS_MANAGER: Arc<Mutex<ProcessManager>> =
        Arc::new(Mutex::new(ProcessManager {
            child: None,
            mode: None,
            config_path: None,
            is_stopping: false,
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

    // All privilege escalation, DNS overrides, sing-box spawn, per-mode
    // watchdogs, and ProcessManager seeding live inside the platform engine.
    // core just drives state-machine transitions and hands off to the
    // readiness prober once the spawn call returns.
    if let Err(e) = PlatformEngine::start(&app, mode.clone(), path).await {
        ::log::error!("Failed to start engine: {}", e);
        // Start can fail partway through (e.g. proxy set fails after the
        // child has already spawned). Ask the platform to tear down whatever
        // it did set up so we don't leak a half-started engine.
        let _ = PlatformEngine::stop(&app).await;
        ProcessManager::acquire().reset();
        let _ = transition(&app, Intent::Fail { reason: e.clone() });
        return Err(e);
    }

    // Give the proxy a beat to settle before readiness probing; TUN takes
    // slightly longer because the helper owns the process and round-trips
    // through XPC/SCM/pkexec.
    let wait_time = if matches!(mode, ProxyMode::TunProxy) { 1500 } else { 1000 };
    tokio::time::sleep(tokio::time::Duration::from_millis(wait_time)).await;
    ::log::info!("Proxy process spawn returned; handing off to readiness prober");
    readiness::spawn(app.clone(), start_epoch);
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

    // Platform engine signals sing-box to stop, clears the system proxy if
    // applicable, and transitions whatever per-mode state it owns. Actual
    // process exit is observed asynchronously by the process monitor which
    // then calls PlatformEngine::on_process_terminated for DNS restore.
    if let Err(e) = PlatformEngine::stop(&app).await {
        ::log::error!("Engine stop returned error: {}", e);
    }

    // Linux and Windows don't go through readiness tick on stop, so drop
    // to Idle explicitly. macOS rides the state machine via the helper
    // exit event → handle_process_termination path.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let _ = transition(&app, Intent::MarkIdle);
    }

    ProcessManager::acquire().reset();

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

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn get_running_config() -> Option<(ProxyMode, String)> {
    let manager = ProcessManager::acquire();
    match (manager.mode.as_ref(), manager.config_path.as_ref()) {
        (Some(mode), Some(path)) => Some(((**mode).clone(), (**path).clone())),
        _ => None,
    }
}

#[tauri::command]
pub async fn reload_config(app: tauri::AppHandle, is_tun: bool) -> Result<String, String> {
    #[cfg(any(unix, target_os = "windows"))]
    {
        let needs_proxy_reset = {
            let manager = ProcessManager::acquire();

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

            matches!(
                manager.mode.as_ref().map(|m| m.as_ref()),
                Some(ProxyMode::SystemProxy)
            )
        };

        ::log::info!("Reloading config");
        PlatformEngine::restart(&app).await?;

        if needs_proxy_reset {
            ::log::info!("SystemProxy mode detected, waiting for reload and resetting proxy");
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Err(e) = crate::engine::apply_system_proxy(&app).await {
                ::log::error!("Failed to reset system proxy after reload: {}", e);
                return Err(format!("Config reloaded but failed to reset proxy: {}", e));
            }
            ::log::info!("System proxy reset successfully after reload");
        }

        Ok("Configuration reloaded successfully".to_string())
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
