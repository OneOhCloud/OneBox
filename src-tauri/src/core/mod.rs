mod log;
pub(crate) mod monitor;

pub use self::log::cleanup_old_onebox_logs;
#[cfg(target_os = "macos")]
pub(crate) use self::log::resolve_singbox_log_path;

use lazy_static::lazy_static;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::app::state::AppData;
use crate::engine::state_machine::{transition, Intent, EngineState, EngineStateCell};
use crate::engine::{readiness, EVENT_STATUS_CHANGED};
use crate::engine::{PlatformEngine, EngineManager};
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;

// ── Diagnostics ──────────────────────────────────────────────────────
//
// Lifecycle calls (`start` / `stop` / `reload_config` and the lifecycle-
// driven restart path in `app/setup.rs`) can fire concurrently from
// multiple triggers — user clicks, Wi-Fi switch debounce, watchdog,
// tray toggles. When one of them ends in "port 6789 is occupied", the
// only way to tell *which* path collided is if every entry records an
// `action=N` token, plus a snapshot of `ProcessManager` (child PID,
// liveness) and the port listener state. These helpers are the raw
// inputs for that snapshot — cheap, no behaviour change.

/// Monotonic per-process action counter. Prefix lifecycle log lines
/// with `action=N` so overlapping calls from independent triggers can
/// be untangled purely from the log stream.
pub(crate) fn next_action_token() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Wall-clock of the previous `reload_config` entry. The frontend
/// (`vpnServiceManager.reload`) does NOT serialize calls, so two
/// quickly-successive config edits dispatch two `pkill -HUP` without
/// any interlock. A short delta here flags that situation.
fn note_reload_entry() -> Option<Duration> {
    static LAST: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    let slot = LAST.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().unwrap_or_else(|e| e.into_inner());
    let elapsed = guard.map(|t| t.elapsed());
    *guard = Some(Instant::now());
    elapsed
}

/// Best-effort check: is *something* already listening on
/// 127.0.0.1:6789 (Mixed inbound) right now? A successful connect
/// means the port is bound — used as a pre-flight before spawning a
/// fresh sing-box and as a post-flight after `pkill -HUP` to detect
/// a failed rebind.
pub(crate) fn probe_mixed_port_listening() -> bool {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 6789);
    TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok()
}

/// `kill(pid, 0)` probe — returns true if the PID still refers to a
/// live process we have permission to signal. Useful to distinguish
/// "ProcessManager still holds a handle but the process is already
/// dead" from "the process is genuinely alive and we're about to
/// spawn on top of it".
#[cfg(unix)]
pub(crate) fn pid_is_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
pub(crate) fn pid_is_alive(_pid: u32) -> bool {
    true
}

/// Snapshot of `ProcessManager` for a single log line. `(child_pid,
/// child_pid_alive, mode)`.
fn pm_snapshot() -> (Option<u32>, Option<bool>, Option<ProxyMode>) {
    let mgr = ProcessManager::acquire();
    let pid = mgr.child.as_ref().map(|c| c.pid());
    let alive = pid.map(pid_is_alive);
    let mode = mgr.mode.as_ref().map(|m| (**m).clone());
    (pid, alive, mode)
}


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
    let action = next_action_token();
    let (pm_pid, pm_alive, pm_mode) = pm_snapshot();
    let port_listening = probe_mixed_port_listening();
    let cur_state_kind = app.state::<EngineStateCell>().snapshot().kind();
    ::log::info!(
        "[start] action={action} mode={:?} state={} pm_child_pid={:?} pm_child_alive={:?} pm_mode={:?} :6789_listener={}",
        mode, cur_state_kind, pm_pid, pm_alive, pm_mode, port_listening
    );
    // Loud flag for the two "about to collide" preconditions. Either alone
    // is enough to explain a subsequent EADDRINUSE in sing-box stderr.
    if port_listening {
        ::log::warn!(
            "[start] action={action} :6789 already has a listener on entry — previous sing-box still bound?"
        );
    }
    if matches!(pm_alive, Some(true)) {
        ::log::warn!(
            "[start] action={action} pm_child_pid={:?} still alive on entry — spawning on top of a live process",
            pm_pid
        );
    }

    {
        let cur = app.state::<EngineStateCell>().snapshot();
        if !matches!(cur, EngineState::Idle { .. } | EngineState::Failed { .. }) {
            ::log::warn!(
                "[start] action={action} engine in {} state, forcing MarkIdle before restart",
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
        ::log::error!("[start] action={action} PlatformEngine::start failed: {}", e);
        // Start can fail partway through (e.g. proxy set fails after the
        // child has already spawned). Ask the platform to tear down whatever
        // it did set up so we don't leak a half-started engine.
        let _ = PlatformEngine::stop(&app).await;
        ProcessManager::acquire().reset();
        let _ = transition(&app, Intent::Fail { reason: e.clone() });
        return Err(e);
    }

    // Platform-specific settle window before readiness probing — TUN
    // round-trips through the privileged companion, SystemProxy just
    // spawns a user-mode sidecar.
    tokio::time::sleep(PlatformEngine::start_settle_delay(&mode)).await;
    let (post_pid, post_alive, _) = pm_snapshot();
    ::log::info!(
        "[start] action={action} spawn returned, handing off to readiness prober (pm_child_pid={:?} alive={:?})",
        post_pid, post_alive
    );
    readiness::spawn(app.clone(), start_epoch);
    Ok(())
}

#[tauri::command]
pub async fn stop(app: tauri::AppHandle) -> Result<(), String> {
    let action = next_action_token();
    let (pm_pid, pm_alive, pm_mode) = pm_snapshot();
    let cur_state_kind = app.state::<EngineStateCell>().snapshot().kind();
    ::log::info!(
        "[stop] action={action} state={} pm_child_pid={:?} pm_child_alive={:?} pm_mode={:?}",
        cur_state_kind, pm_pid, pm_alive, pm_mode
    );

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
        ::log::error!("[stop] action={action} PlatformEngine::stop returned error: {}", e);
    }

    // Linux and Windows don't go through readiness tick on stop, so drop
    // to Idle explicitly. macOS rides the state machine via the helper
    // exit event → handle_process_termination path.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let _ = transition(&app, Intent::MarkIdle);
    }

    ProcessManager::acquire().reset();

    // Post-stop port probe: `PlatformEngine::stop` only SIGTERMs + sleeps
    // 500ms, it does NOT wait for the process to actually exit. If this
    // line reports `:6789_listener=true`, the next `start` call is about
    // to collide with a still-alive sing-box.
    let port_listening = probe_mixed_port_listening();
    if port_listening {
        ::log::warn!(
            "[stop] action={action} returning with :6789 STILL LISTENING — pm_child_pid={:?} may have survived SIGTERM",
            pm_pid
        );
    } else {
        ::log::info!("[stop] action={action} returned, :6789 released");
    }
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
pub async fn reload_config(app: tauri::AppHandle) -> Result<String, String> {
    let action = next_action_token();
    let since_last = note_reload_entry();
    let since_last_str = since_last
        .map(|d| format!("{}ms", d.as_millis()))
        .unwrap_or_else(|| "first".into());
    let (pm_pid, pm_alive, pm_mode) = pm_snapshot();
    let port_listening = probe_mixed_port_listening();
    ::log::info!(
        "[reload] action={action} entry since_last={} pm_child_pid={:?} pm_child_alive={:?} pm_mode={:?} :6789_listener={}",
        since_last_str, pm_pid, pm_alive, pm_mode, port_listening
    );
    if let Some(delta) = since_last {
        if delta.as_millis() < 2000 {
            ::log::warn!(
                "[reload] action={action} back-to-back: only {}ms since last reload — frontend is not serializing",
                delta.as_millis()
            );
        }
    }
    if !port_listening {
        ::log::warn!(
            "[reload] action={action} :6789 NOT listening on entry — sing-box may already be down; SIGHUP will no-op"
        );
    }

    #[cfg(any(unix, target_os = "windows"))]
    {
        let needs_proxy_reset = {
            let manager = ProcessManager::acquire();
            match manager.mode.as_ref().map(|m| m.as_ref()) {
                Some(ProxyMode::TunProxy) => false,
                Some(ProxyMode::SystemProxy) => true,
                None => {
                    ::log::warn!("[reload] action={action} rejected: no running process");
                    return Err("No running process found".to_string());
                }
            }
        };

        ::log::info!("[reload] action={action} dispatching PlatformEngine::restart");
        PlatformEngine::restart(&app).await?;

        if needs_proxy_reset {
            ::log::info!(
                "[reload] action={action} SystemProxy — sleeping 500ms for sing-box rebind, then re-apply proxy"
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            let still_listening = probe_mixed_port_listening();
            if !still_listening {
                // Decisive signal: SIGHUP was sent, 500ms later the port
                // has no listener. Either (a) sing-box's Close()+create()
                // cycle hasn't rebound yet (bind failed, Close took too
                // long, log.Fatal exit), or (b) sing-box died outright.
                ::log::warn!(
                    "[reload] action={action} :6789 NOT listening 500ms after SIGHUP — sing-box rebind FAILED or process died"
                );
            } else {
                ::log::info!("[reload] action={action} :6789 listener up 500ms after SIGHUP");
            }
            if let Err(e) = crate::engine::apply_system_proxy(&app).await {
                ::log::error!("[reload] action={action} re-apply system proxy failed: {}", e);
                return Err(format!("Config reloaded but failed to reset proxy: {}", e));
            }
            ::log::info!("[reload] action={action} system proxy re-applied");
        }

        ::log::info!("[reload] action={action} done");
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
