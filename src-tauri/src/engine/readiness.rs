//! Readiness prober — elevates `Starting → Running` from "spawn returned"
//! to "sing-box is actually serving traffic".
//!
//! The prober is spawned as a tokio task at the tail of the Start path. It
//! polls a platform-independent liveness predicate every 200 ms until one of
//! three terminal conditions:
//!
//!   1. predicate satisfied → `transition(MarkRunning)`
//!   2. 20 s elapsed        → `transition(Fail { reason: "startup timeout" })`
//!   3. state changed away from `Starting` (user stop, crash, etc.) → exit
//!
//! Generation guard: the task captures the epoch at spawn. Before any
//! transition attempt it rechecks the current state; if the epoch has
//! advanced past the captured value, the prober assumes it has been
//! superseded and exits silently. This prevents a stale prober from
//! clobbering a restarted session.
//!
//! Liveness predicate: TCP connect to `127.0.0.1:9191` (sing-box clash API
//! port). Works uniformly across platforms and both TUN and mixed modes;
//! on TUN mode the clash API only comes up after the TUN device is
//! initialised and DNS override has already been applied synchronously on
//! the Start path, so a successful connect implies routable readiness.

use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::net::TcpStream;
use tokio::time::{sleep, timeout, Instant};

use super::state_machine::{transition, Intent, EngineState, EngineStateCell};

const POLL_INTERVAL: Duration = Duration::from_millis(200);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const PROBE_ADDR: &str = "127.0.0.1:9191";
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(150);

/// Spawn a readiness prober. `start_epoch` must be the epoch observed right
/// after the `Starting` transition completes.
pub fn spawn(app: AppHandle, start_epoch: u64) {
    tokio::spawn(async move {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            // Superseded check (generation guard).
            let snap = app.state::<EngineStateCell>().snapshot();
            if !matches!(snap, EngineState::Starting { .. }) || snap.epoch() != start_epoch {
                log::debug!(
                    "[readiness] superseded (kind={}, epoch={}, captured={}), exiting",
                    snap.kind(),
                    snap.epoch(),
                    start_epoch
                );
                return;
            }

            if probe_once().await {
                log::info!("[readiness] probe succeeded, transitioning to Running");
                let _ = transition(&app, Intent::MarkRunning);
                return;
            }

            if Instant::now() >= deadline {
                log::warn!("[readiness] startup timeout after {:?}", STARTUP_TIMEOUT);
                let _ = transition(
                    &app,
                    Intent::Fail {
                        reason: "startup timeout".into(),
                    },
                );
                return;
            }

            sleep(POLL_INTERVAL).await;
        }
    });
}

async fn probe_once() -> bool {
    matches!(
        timeout(PROBE_CONNECT_TIMEOUT, TcpStream::connect(PROBE_ADDR)).await,
        Ok(Ok(_))
    )
}
