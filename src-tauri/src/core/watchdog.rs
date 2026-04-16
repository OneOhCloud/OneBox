use std::sync::Arc;

use crate::engine::state_machine::{transition, Intent, EngineStateCell};
use crate::engine::{readiness, EVENT_STATUS_CHANGED};
use tauri::Emitter;
use tauri::Manager;

use super::monitor::handle_process_termination;
use super::{ProxyMode, PROCESS_MANAGER};

// ── macOS: bypass-router 4-hour restart watchdog ──────────────────────

#[cfg(target_os = "macos")]
const BYPASS_ROUTER_RESTART_INTERVAL: std::time::Duration =
    std::time::Duration::from_secs(4 * 3600);

/// Restart sing-box via the privileged helper (Send-safe, no keychain).
#[cfg(target_os = "macos")]
async fn restart_tun_send_safe(
    app: tauri::AppHandle,
    path: Arc<String>,
) -> Result<(), String> {
    let app_c = app.clone();
    let path_c = path.as_ref().clone();
    let _pid = tokio::task::spawn_blocking(move || {
        crate::engine::macos::start_tun_via_helper(&app_c, &path_c)
    })
    .await
    .map_err(|e| format!("restart join error: {}", e))?
    .map_err(|e| format!("restart start_tun_via_helper failed: {}", e))?;

    let mut exit_rx = crate::engine::macos::helper::subscribe_sing_box_exits();
    let exit_app = app.clone();
    let exit_mode = Arc::new(ProxyMode::TunProxy);
    tokio::spawn(async move {
        if let Some(exit) = exit_rx.recv().await {
            log::info!(
                "[helper-bridge] sing-box exit (watchdog restart) pid={} code={}",
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

    {
        let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
        manager.mode = Some(Arc::new(ProxyMode::TunProxy));
        manager.config_path = Some(Arc::clone(&path));
        manager.child = None;
        manager.is_stopping = false;
    }

    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    app.emit(EVENT_STATUS_CHANGED, ()).ok();

    let _ = transition(&app, Intent::Start { mode: "tun".into() });
    let epoch_snap = app.state::<EngineStateCell>().snapshot().epoch();
    readiness::spawn(app.clone(), epoch_snap);

    Ok(())
}

/// Bypass-router watchdog: restart sing-box every 4 hours to clear
/// stale routes from `auto_detect_interface`.
#[cfg(target_os = "macos")]
pub(super) async fn bypass_router_watchdog(app: tauri::AppHandle, path: Arc<String>) {
    loop {
        tokio::time::sleep(BYPASS_ROUTER_RESTART_INTERVAL).await;

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

        {
            let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting = true;
        }

        let stop_result = tokio::task::spawn_blocking(crate::engine::macos::stop_tun_process).await;
        if let Err(e) = stop_result.map_err(|e| e.to_string()).and_then(|r| r) {
            log::error!("[bypass_router_watchdog] stop_tun_process failed: {}", e);
            let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting = false;
            continue;
        }

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        {
            let mut manager = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
            manager.bypass_router_restarting = false;
        }

        if let Err(e) = restart_tun_send_safe(app.clone(), Arc::clone(&path)).await {
            log::error!("[bypass_router_watchdog] restart failed: {}", e);
        }
    }
}

// ── Windows: service state watchdog ───────────────────────────────────

/// 1Hz poll of the Windows service state. When Running→Stopped is observed,
/// synthesize a handle_process_termination call.
#[cfg(target_os = "windows")]
pub(super) fn spawn_windows_service_watchdog(
    app: tauri::AppHandle,
    process_mode: Arc<ProxyMode>,
    _start_epoch: u64,
) {
    tokio::spawn(async move {
        use tun_service::scm::{query_state, QueriedState};
        let mut observed_running = false;
        loop {
            let still_tun = {
                let m = PROCESS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
                m.mode
                    .as_ref()
                    .map(|x| matches!(**x, ProxyMode::TunProxy))
                    .unwrap_or(false)
            };
            if !still_tun {
                return;
            }

            match query_state() {
                QueriedState::Running => observed_running = true,
                QueriedState::Stopped | QueriedState::NotInstalled if observed_running => {
                    log::info!(
                        "[win-svc-watchdog] service transitioned to stopped — firing handle_process_termination"
                    );
                    let payload = tauri_plugin_shell::process::TerminatedPayload {
                        code: Some(0),
                        signal: None,
                    };
                    handle_process_termination(&app, &process_mode, payload).await;
                    return;
                }
                _ => {}
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}
