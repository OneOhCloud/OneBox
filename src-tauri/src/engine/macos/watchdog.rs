//! Bypass-router restart watchdog (macOS TUN mode only).
//!
//! Periodically (every 4 hours) restarts sing-box via the privileged helper
//! so macOS's `auto_detect_interface` picks up routing changes that would
//! otherwise accumulate as stale entries — long-lived TUN sessions on
//! roaming laptops tend to drift as Wi-Fi networks change.
//!
//! All state lives in this module; `core` does not see the watchdog.
//! The only cross-module concession is the `is_restart_in_progress` flag
//! read by `core::monitor` to skip the normal cleanup path during a
//! watchdog-triggered restart.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};

use crate::core::monitor::handle_process_termination;
use crate::core::{ProcessManager, ProxyMode};
use crate::engine::state_machine::{transition, EngineStateCell, Intent};
use crate::engine::{readiness, EVENT_STATUS_CHANGED};

use super::helper as macos_helper;

pub const BYPASS_ROUTER_RESTART_INTERVAL: std::time::Duration =
    std::time::Duration::from_secs(4 * 3600);

// Flag set while a watchdog restart is mid-flight (between stop and start).
// `core::monitor::handle_process_termination` reads this to skip the
// normal cleanup path so the impending restart isn't mistaken for a crash.
static RESTART_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

// Abort handle for the currently-running watchdog task, so
// `MacOSEngine::start` can cancel an old watchdog before spawning a new one
// and `on_process_terminated` can cancel it when TUN mode exits.
static ABORT_HANDLE: Mutex<Option<tokio::task::AbortHandle>> = Mutex::new(None);

/// True iff the watchdog is currently between stop and start of a restart
/// cycle — `core::monitor` uses this to suppress its normal cleanup path.
pub fn is_restart_in_progress() -> bool {
    RESTART_IN_PROGRESS.load(Ordering::SeqCst)
}

/// Spawn the bypass-router watchdog if not already running. Safe to call
/// on every `start(TunProxy)` — cancels any prior instance before spawning
/// a fresh one with the new config path.
pub fn spawn(app: AppHandle, config_path: Arc<String>) {
    cancel();
    let task = tokio::spawn(run(app, config_path));
    let mut guard = ABORT_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(task.abort_handle());
    log::info!(
        "[bypass_router_watchdog] started, next restart in {}h",
        BYPASS_ROUTER_RESTART_INTERVAL.as_secs() / 3600
    );
}

/// Cancel the running watchdog if any. Idempotent.
pub fn cancel() {
    let mut guard = ABORT_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(abort) = guard.take() {
        abort.abort();
    }
}

async fn run(app: AppHandle, path: Arc<String>) {
    loop {
        tokio::time::sleep(BYPASS_ROUTER_RESTART_INTERVAL).await;

        let still_tun = {
            let manager = ProcessManager::acquire();
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
            "[bypass_router_watchdog] scheduled restart after {}h to refresh routing table",
            BYPASS_ROUTER_RESTART_INTERVAL.as_secs() / 3600
        );

        RESTART_IN_PROGRESS.store(true, Ordering::SeqCst);

        if let Err(e) = super::stop_tun_process().await {
            log::error!("[bypass_router_watchdog] stop_tun_process failed: {}", e);
            RESTART_IN_PROGRESS.store(false, Ordering::SeqCst);
            continue;
        }

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        RESTART_IN_PROGRESS.store(false, Ordering::SeqCst);

        if let Err(e) = restart_tun_send_safe(app.clone(), Arc::clone(&path)).await {
            log::error!("[bypass_router_watchdog] restart failed: {}", e);
        }
    }
}

/// Restart sing-box via the privileged helper (Send-safe, no keychain).
async fn restart_tun_send_safe(app: AppHandle, path: Arc<String>) -> Result<(), String> {
    let app_c = app.clone();
    let path_c = path.as_ref().clone();
    let _pid = tokio::task::spawn_blocking(move || super::start_tun_via_helper(&app_c, &path_c))
        .await
        .map_err(|e| format!("restart join error: {}", e))?
        .map_err(|e| format!("restart start_tun_via_helper failed: {}", e))?;

    {
        let mut manager = ProcessManager::acquire();
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

    // Subscribe to the restarted sing-box's exit event. The epoch is snapped
    // after the Starting transition above so the guard correctly identifies
    // stale handlers from prior sessions.
    let mut exit_rx = macos_helper::subscribe_sing_box_exits();
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
            handle_process_termination(&exit_app, &exit_mode, payload, epoch_snap).await;
        }
    });

    Ok(())
}
