//! Windows service-state watchdog.
//!
//! sing-box runs inside the OneBoxTunService (an SCM service process),
//! and if that process exits for any reason other than our own `stop`
//! we have to synthesize the same cleanup path the sidecar child monitor
//! provides on the other two platforms — otherwise the UI never learns
//! the engine died.

use std::sync::Arc;

use tauri::AppHandle;

use crate::core::monitor::handle_process_termination;
use crate::core::{ProcessManager, ProxyMode};

/// 1Hz poll of the Windows service state. When Running→Stopped is
/// observed (and only after we've seen at least one Running tick, so we
/// don't fire on the initial "not yet started" window), synthesize a
/// `handle_process_termination` call.
pub(crate) fn spawn(app: AppHandle, process_mode: Arc<ProxyMode>, spawn_epoch: u64) {
    let generation = super::egress::generation();
    tokio::spawn(async move {
        use tun_service::scm::{query_state, QueriedState};
        let mut observed_running = false;
        loop {
            if generation != super::egress::generation() {
                return;
            }
            if super::egress::reconfiguring() {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                continue;
            }
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

            // Serialize the state sample with service replacement, including rollback.
            let operation = super::egress::OPERATIONS.lock().await;
            if generation != super::egress::generation() {
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
                    handle_process_termination(&app, &process_mode, payload, spawn_epoch).await;
                    return;
                }
                _ => {}
            }
            drop(operation);
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}
