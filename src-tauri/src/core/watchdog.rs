//! Cross-platform watchdog plumbing. macOS's bypass-router watchdog now
//! lives in `engine::macos::watchdog`; only the Windows service-state
//! watchdog remains here, pending relocation into `engine::windows`.

#[cfg(target_os = "windows")]
use std::sync::Arc;

#[cfg(target_os = "windows")]
use super::monitor::handle_process_termination;
#[cfg(target_os = "windows")]
use super::{ProcessManager, ProxyMode};

/// 1Hz poll of the Windows service state. When Running→Stopped is observed,
/// synthesize a `handle_process_termination` call.
#[cfg(target_os = "windows")]
pub(crate) fn spawn_windows_service_watchdog(
    app: tauri::AppHandle,
    process_mode: Arc<ProxyMode>,
    _start_epoch: u64,
) {
    tokio::spawn(async move {
        use tun_service::scm::{query_state, QueriedState};
        let mut observed_running = false;
        loop {
            let still_tun = {
                let m = ProcessManager::acquire();
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
