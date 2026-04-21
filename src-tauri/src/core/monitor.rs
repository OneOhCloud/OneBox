use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;

use crate::engine::state_machine::{transition, EngineState, EngineStateCell, Intent};
use crate::engine::{EngineManager, PlatformEngine, EVENT_STATUS_CHANGED};
use crate::app::state::{AppData, LogType};

use super::log::{create_singbox_log_writer, write_singbox_log};
use super::{ProcessManager, ProxyMode};

/// Spawn the sing-box stdout/stderr monitor as a tokio task.
/// Routes output to log file + frontend events, and handles termination.
///
/// `child_pid` is the OS pid of the process Tauri spawned — on macOS
/// / Windows SystemProxy and Linux SystemProxy it's sing-box itself,
/// on Linux TUN it's `pkexec` (sing-box runs as its child). It's only
/// used as a stable identifier in log lines so Terminated / stderr
/// bind-error / spawn entries can be correlated across the full log.
pub(crate) fn spawn_process_monitor(
    app: tauri::AppHandle,
    mut rx: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
    mode: Arc<ProxyMode>,
    child_pid: u32,
) {
    let mut singbox_log = create_singbox_log_writer(&app);
    let spawn_at = std::time::Instant::now();
    log::info!(
        "[sing-box] monitor attached pid={} mode={:?}",
        child_pid, mode
    );
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
                    scan_stderr_for_bind_error(child_pid, &line_str);
                    app_status_data.write(line_str.to_string(), LogType::Info);
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    log::error!("[sing-box] pid={} process error: {}", child_pid, err);
                    write_singbox_log(&mut singbox_log, &format!("[ERROR] {}", err));
                    app_status_data.write(err.to_string(), LogType::Error);
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    terminated = true;
                    let runtime = spawn_at.elapsed();
                    log::info!(
                        "[sing-box] pid={} terminated runtime={:.2}s code={:?} signal={:?}",
                        child_pid,
                        runtime.as_secs_f64(),
                        payload.code,
                        payload.signal
                    );
                    #[allow(unused_variables)]
                    let adjusted_payload = {
                        #[cfg(target_os = "windows")]
                        {
                            let is_stopping = {
                                let manager = ProcessManager::acquire();
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

/// Sing-box emits `listen tcp 127.0.0.1:6789: bind: address already in
/// use` (or the platform's localized equivalent) on stderr when its
/// Mixed inbound's `listenConfig.Listen()` returns EADDRINUSE. The raw
/// line goes to sing-box.log regardless; we additionally echo a
/// prominent warn to the main OneBox.log so triage doesn't need to
/// cross-reference two files.
fn scan_stderr_for_bind_error(pid: u32, line: &str) {
    let lc = line.to_ascii_lowercase();
    if lc.contains("address already in use") || lc.contains("eaddrinuse") {
        log::warn!(
            "[sing-box] pid={} BIND FAILED: {}",
            pid,
            line.trim_end()
        );
    } else if lc.contains("listen tcp") && lc.contains("bind:") {
        log::warn!(
            "[sing-box] pid={} listener error: {}",
            pid,
            line.trim_end()
        );
    }
}

/// Handle sing-box process termination (intentional stop or crash).
/// Cleans up DNS, proxy, and transitions the state machine.
pub(crate) async fn handle_process_termination(
    app_handle: &tauri::AppHandle,
    process_mode: &Arc<ProxyMode>,
    payload: tauri_plugin_shell::process::TerminatedPayload,
) {
    #[cfg(target_os = "macos")]
    if crate::engine::macos::watchdog::is_restart_in_progress() {
        log::info!(
            "[handle_process_termination] bypass_router_watchdog restart in progress, skipping cleanup"
        );
        return;
    }

    // Phase 1: confirm the exiting process belongs to the mode we think is
    // active, and decide whether this was a user-initiated stop. Do NOT
    // reset ProcessManager yet — the platform's on_process_terminated hook
    // below may need to read teardown state (e.g. Linux dns_override) that
    // lives there.
    let (should_cleanup, was_user_initiated_stop) = {
        let manager = ProcessManager::acquire();
        let matches = manager
            .mode
            .as_ref()
            .map(|m| **m == **process_mode)
            .unwrap_or(false);
        if matches {
            log::info!("Cleaning up resources after process termination");
            (true, manager.is_stopping)
        } else {
            (false, false)
        }
    };

    if !should_cleanup {
        log::info!("Process mode has changed, skipping cleanup");
        return;
    }

    if matches!(**process_mode, ProxyMode::SystemProxy) {
        if let Err(e) = crate::engine::clear_system_proxy(app_handle).await {
            log::error!("Failed to unset proxy after process termination: {}", e);
        }
    }

    if matches!(**process_mode, ProxyMode::TunProxy) {
        PlatformEngine::on_process_terminated(app_handle, was_user_initiated_stop);
    }

    // Phase 2: now that platform teardown has run and consumed whatever state
    // it needed, reset ProcessManager. The old `reset()` return value is
    // ignored — dns_override consumption is a platform concern.
    ProcessManager::acquire().reset();

    if let Err(e) = app_handle.emit(EVENT_STATUS_CHANGED, payload.clone()) {
        log::error!("Failed to emit status-changed event: {}", e);
    }

    let cur = app_handle.state::<EngineStateCell>().snapshot();
    match cur {
        EngineState::Stopping { .. } => {
            let _ = transition(app_handle, Intent::MarkIdle);
        }
        EngineState::Running { .. } | EngineState::Starting { .. } => {
            let code = payload.code.unwrap_or(-1);
            if code == 0 {
                let _ = transition(app_handle, Intent::MarkIdle);
            } else {
                let _ = transition(
                    app_handle,
                    Intent::Fail {
                        reason: format!("sing-box exited unexpectedly (code={})", code),
                    },
                );
            }
        }
        _ => {}
    }
}
