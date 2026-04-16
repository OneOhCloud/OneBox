use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;

use crate::engine::state_machine::{transition, Intent, EngineState, EngineStateCell};
use crate::engine::{PlatformEngine, EngineManager, EVENT_STATUS_CHANGED};
use crate::state::{AppData, LogType};

use super::log::{create_singbox_log_writer, write_singbox_log};
use super::{ProxyMode, PROCESS_MANAGER};

/// Spawn the sing-box stdout/stderr monitor as a tokio task.
/// Routes output to log file + frontend events, and handles termination.
pub(super) fn spawn_process_monitor(
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
                    #[allow(unused_variables)]
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

/// Handle sing-box process termination (intentional stop or crash).
/// Cleans up DNS, proxy, and transitions the state machine.
pub(super) async fn handle_process_termination(
    app_handle: &tauri::AppHandle,
    process_mode: &Arc<ProxyMode>,
    payload: tauri_plugin_shell::process::TerminatedPayload,
) {
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

    #[allow(unused_variables)]
    let (should_cleanup, was_user_initiated_stop, captured_dns_override) = {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| {
            log::error!("Failed to lock process manager: {:?}", e);
            e.into_inner()
        });

        let matches = manager
            .mode
            .as_ref()
            .map(|m| **m == **process_mode)
            .unwrap_or(false);

        #[allow(unused_assignments)]
        let mut dns_info: Option<(String, String)> = None;

        let stopping = if matches {
            log::info!("Cleaning up resources after process termination");
            let was_stopping = manager.is_stopping;
            #[cfg(target_os = "linux")]
            {
                dns_info = manager.dns_override.take();
            }
            #[cfg(not(target_os = "linux"))]
            {
                dns_info = None;
            }
            manager.child = None;
            manager.mode = None;
            manager.config_path = None;
            manager.is_stopping = false;
            #[cfg(target_os = "macos")]
            if let Some(abort) = manager.bypass_router_watchdog_abort.take() {
                abort.abort();
            }
            was_stopping
        } else {
            dns_info = None;
            false
        };
        (matches, stopping, dns_info)
    };

    if !should_cleanup {
        log::info!("Process mode has changed, skipping cleanup");
        return;
    }

    #[cfg(not(target_os = "windows"))]
    let _ = was_user_initiated_stop;

    if matches!(**process_mode, ProxyMode::SystemProxy) {
        if let Err(e) = PlatformEngine::unset_proxy(app_handle).await {
            log::error!("Failed to unset proxy after process termination: {}", e);
        }
    }

    if matches!(**process_mode, ProxyMode::TunProxy) {
        #[cfg(target_os = "macos")]
        {
            log::info!("[dns] TUN process terminated — resetting all services to DHCP");
            if let Err(e) = crate::engine::macos::restore_system_dns() {
                log::warn!("[dns] fallback restore_system_dns failed: {}", e);
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Some((iface, original_dns)) = captured_dns_override {
                log::info!(
                    "[dns] TUN process terminated — restoring [{}] DNS to {}",
                    iface,
                    original_dns
                );
                if let Err(e) = crate::engine::linux::restore_system_dns(&iface, &original_dns) {
                    log::warn!("[dns] fallback restore_system_dns failed: {}", e);
                }
            } else {
                log::warn!(
                    "[dns] TUN terminated but no dns_override captured; DNS may need manual restore"
                );
            }
        }
        #[cfg(target_os = "windows")]
        {
            if was_user_initiated_stop {
                log::info!(
                    "[dns] user-initiated stop; service already reset DNS, skipping UAC fallback"
                );
            } else {
                log::warn!(
                    "[dns] TUN process terminated unexpectedly — requesting UAC DNS restore"
                );
                if let Err(e) = crate::engine::windows::restore_system_dns() {
                    log::warn!("[dns] fallback restore_system_dns failed: {}", e);
                }
            }
        }
    }

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
