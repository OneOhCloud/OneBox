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
    spawn_epoch: u64,
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
                    log::debug!("[sing-box-event] pid={} Stdout", child_pid);
                    let line_str = String::from_utf8_lossy(&line);
                    write_singbox_log(&mut singbox_log, &line_str);
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    log::debug!("[sing-box-event] pid={} Stderr", child_pid);
                    let line_str = String::from_utf8_lossy(&line);
                    write_singbox_log(&mut singbox_log, &line_str);
                    scan_stderr_for_bind_error(child_pid, &line_str);
                    app_status_data.write(line_str.to_string(), LogType::Info);
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    log::debug!("[sing-box-event] pid={} Error", child_pid);
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
                                log::info!(
                                    "[monitor] windows code remap applied orig_code=1 new_code=0 is_stopping=true pid={}",
                                    child_pid
                                );
                                tauri_plugin_shell::process::TerminatedPayload {
                                    code: Some(0),
                                    signal: payload.signal,
                                }
                            } else {
                                log::debug!(
                                    "[monitor] windows code remap not applied pid={} is_stopping={} code={:?}",
                                    child_pid, is_stopping, payload.code
                                );
                                payload
                            }
                        }
                        #[cfg(not(target_os = "windows"))]
                        payload
                    };
                    handle_process_termination(&app, &mode, adjusted_payload, spawn_epoch).await;
                }
                _ => {
                    log::debug!("[sing-box-event] pid={} other event received", child_pid);
                }
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

/// Returns `true` when the termination handler was spawned for an older engine
/// session and should be skipped. Mirrors the sibling check in
/// `engine/common/readiness.rs:45`.
///
/// Three cases:
///   `spawn == current` → same session, handle normally → `false`
///   `spawn < current`  → superseded session, skip         → `true`
///   `spawn > current`  → should never happen in prod; prefer drop over corrupt → `true`
#[inline]
pub(crate) fn epoch_guard_stale(spawn_epoch: u64, current_epoch: u64) -> bool {
    spawn_epoch != current_epoch
}

/// Handle sing-box process termination (intentional stop or crash).
/// Cleans up DNS, proxy, and transitions the state machine.
pub(crate) async fn handle_process_termination(
    app_handle: &tauri::AppHandle,
    process_mode: &Arc<ProxyMode>,
    payload: tauri_plugin_shell::process::TerminatedPayload,
    spawn_epoch: u64,
) {
    let current_epoch = app_handle.state::<EngineStateCell>().snapshot().epoch();
    let is_stale = epoch_guard_stale(spawn_epoch, current_epoch);
    if is_stale {
        log::info!(
            "[monitor] guard: stale epoch captured={} current={} mode={:?} code={:?} — skipping cleanup",
            spawn_epoch, current_epoch, process_mode, payload.code
        );
    }

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
    let (pm_pid, manager_mode, matches, is_stopping) = {
        let manager = ProcessManager::acquire();
        let pm_pid = manager.child.as_ref().map(|c| c.pid());
        let manager_mode = manager.mode.as_ref().map(|m| (**m).clone());
        let matches = manager
            .mode
            .as_ref()
            .map(|m| **m == **process_mode)
            .unwrap_or(false);
        let is_stopping = manager.is_stopping;
        (pm_pid, manager_mode, matches, is_stopping)
    };
    let engine_state = app_handle.state::<crate::engine::state_machine::EngineStateCell>().snapshot();
    log::info!(
        "[monitor] handle_process_termination entry pid={:?} code={:?} signal={:?} is_stopping={} process_mode={:?} manager_mode={:?} engine_state={}",
        pm_pid, payload.code, payload.signal, is_stopping,
        process_mode, manager_mode, engine_state.kind()
    );
    let (should_cleanup, was_user_initiated_stop) = if matches {
        log::info!("Cleaning up resources after process termination");
        log::info!(
            "[monitor] should_cleanup=true is_stopping={} mode={:?}",
            is_stopping, process_mode
        );
        (true, is_stopping)
    } else {
        log::info!(
            "[monitor] should_cleanup=false reason=mode_mismatch process_mode={:?} manager_mode={:?}",
            process_mode, manager_mode
        );
        (false, false)
    };

    // Only run cleanup if: (1) mode matches, (2) not stale epoch, and (3) not in a macOS watchdog restart
    if should_cleanup && !is_stale {
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
    }

    if let Err(e) = app_handle.emit(EVENT_STATUS_CHANGED, payload.clone()) {
        log::error!("Failed to emit status-changed event: {}", e);
    }

    let cur = app_handle.state::<EngineStateCell>().snapshot();
    match cur {
        EngineState::Stopping { .. } => {
            log::info!(
                "[monitor] intent=MarkIdle reason=user_stop engine_state={} code={:?}",
                cur.kind(), payload.code
            );
            let _ = transition(app_handle, Intent::MarkIdle);
        }
        EngineState::Running { .. } | EngineState::Starting { .. } => {
            let code = payload.code.unwrap_or(-1);
            if code == 0 {
                log::info!(
                    "[monitor] intent=MarkIdle reason=clean_exit engine_state={} code=0",
                    cur.kind()
                );
                let _ = transition(app_handle, Intent::MarkIdle);
            } else {
                log::info!(
                    "[monitor] intent=Fail reason=unexpected_exit engine_state={} code={}",
                    cur.kind(), code
                );
                let _ = transition(
                    app_handle,
                    Intent::Fail {
                        reason: format!("sing-box exited unexpectedly (code={})", code),
                    },
                );
            }
        }
        _ => {
            log::info!(
                "[monitor] intent=none engine_state={} code={:?} no transition taken",
                cur.kind(), payload.code
            );
        }
    }
}

#[cfg(test)]
mod epoch_guard_tests {
    use super::epoch_guard_stale;

    #[test]
    fn same_epoch_is_not_stale() {
        assert!(!epoch_guard_stale(5, 5));
    }

    #[test]
    fn older_spawn_epoch_is_stale() {
        assert!(epoch_guard_stale(1, 3));
    }

    #[test]
    fn spawn_epoch_ahead_of_current_is_stale() {
        // Should never happen in prod; prefer drop over corrupt state.
        assert!(epoch_guard_stale(3, 1));
    }
}

#[cfg(test)]
mod engine_state_cell_integration_tests {
    use crate::engine::state_machine::EngineStateCell;
    use super::epoch_guard_stale;

    /// Drive EngineStateCell through two start cycles using the real atomic
    /// (via the public bump_epoch_for_test helper), simulating:
    ///   Idle{ep=0} → Starting{ep=1} → Idle{ep=2} → Starting{ep=3}
    ///
    /// A stale handler carrying spawn_epoch=1 must trip the guard when the
    /// cell has advanced to ep=3. A handler from the current session (ep=3)
    /// must pass.
    ///
    /// Smoke-check: if epoch_guard_stale is changed to return false
    /// unconditionally, the first assert below fails.
    #[test]
    fn stale_handler_from_first_session_trips_guard_at_third_epoch() {
        let cell = EngineStateCell::new();
        assert_eq!(cell.current_epoch(), 0); // Idle{ep=0}

        // First start: Idle → Starting{ep=1}
        let ep1 = cell.bump_epoch_for_test();
        assert_eq!(ep1, 1);
        assert_eq!(cell.current_epoch(), 1);

        // Stop: Starting → Idle{ep=2}
        let _ep2 = cell.bump_epoch_for_test();
        assert_eq!(cell.current_epoch(), 2);

        // Second start: Idle → Starting{ep=3}
        let ep3 = cell.bump_epoch_for_test();
        assert_eq!(ep3, 3);
        assert_eq!(cell.current_epoch(), 3);

        // Stale handler from first session must be dropped.
        assert!(epoch_guard_stale(ep1, cell.current_epoch()));

        // Handler from current session must pass.
        assert!(!epoch_guard_stale(ep3, cell.current_epoch()));
    }
}
