//! VPN lifecycle state machine — authoritative, lives in the Rust core.
//!
//! Single write entry: `transition()`. It acquires the state lock, validates
//! the transition, increments the epoch counter under the same lock, emits
//! `vpn://state`, and logs the change. Every other site that needs to read
//! state uses `VpnStateCell::snapshot()`.
//!
//! The `epoch` field on every variant is strictly monotonic; the frontend
//! uses it to drop out-of-order events. Prober tasks capture the epoch at
//! spawn and refuse to transition if it has advanced.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_VPN_STATE: &str = "vpn-state";

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum VpnState {
    Idle {
        epoch: u64,
    },
    Starting {
        since: i64,
        epoch: u64,
        mode: String,
    },
    Running {
        since: i64,
        epoch: u64,
        mode: String,
    },
    Stopping {
        since: i64,
        epoch: u64,
    },
    Failed {
        reason: String,
        at: i64,
        epoch: u64,
    },
}

impl VpnState {
    pub fn kind(&self) -> &'static str {
        match self {
            VpnState::Idle { .. } => "idle",
            VpnState::Starting { .. } => "starting",
            VpnState::Running { .. } => "running",
            VpnState::Stopping { .. } => "stopping",
            VpnState::Failed { .. } => "failed",
        }
    }

    pub fn epoch(&self) -> u64 {
        match self {
            VpnState::Idle { epoch }
            | VpnState::Starting { epoch, .. }
            | VpnState::Running { epoch, .. }
            | VpnState::Stopping { epoch, .. }
            | VpnState::Failed { epoch, .. } => *epoch,
        }
    }

    pub fn mode(&self) -> Option<&str> {
        match self {
            VpnState::Starting { mode, .. } | VpnState::Running { mode, .. } => Some(mode.as_str()),
            _ => None,
        }
    }
}

/// Held in Tauri `State`, registered in `setup::app_setup`.
pub struct VpnStateCell {
    inner: Mutex<VpnState>,
    counter: AtomicU64,
}

impl VpnStateCell {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VpnState::Idle { epoch: 0 }),
            counter: AtomicU64::new(0),
        }
    }

    pub fn snapshot(&self) -> VpnState {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn current_epoch(&self) -> u64 {
        self.counter.load(Ordering::SeqCst)
    }
}

impl Default for VpnStateCell {
    fn default() -> Self {
        Self::new()
    }
}

/// Intents the caller can hand to `transition()`. Each intent is validated
/// against the current state; illegal combinations return `Err` and do not
/// mutate the cell.
#[derive(Debug)]
pub enum Intent {
    /// Idle/Failed → Starting. `mode` is `"tun"` or `"mixed"`.
    Start { mode: String },
    /// Starting → Running.
    MarkRunning,
    /// Running → Stopping.
    Stop,
    /// Starting/Stopping/Running → Idle. Used by the termination path when
    /// the child process is confirmed gone.
    MarkIdle,
    /// Any transitional state → Failed with a reason.
    Fail { reason: String },
    /// Stopping → Running. Used when a stop attempt was abandoned (Windows
    /// UAC cancel) and sing-box is still alive.
    RollbackToRunning { mode: String },
    /// Failed → Idle. Explicit user acknowledgement.
    ClearFailure,
}

fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Apply an `Intent` to the state cell under lock, emit `vpn://state`, and
/// return the new state. Rejects illegal transitions.
pub fn transition(app: &AppHandle, intent: Intent) -> Result<VpnState, String> {
    let cell = app.state::<VpnStateCell>();
    let mut guard = cell.inner.lock().unwrap_or_else(|e| e.into_inner());
    let current = guard.clone();

    let new_state = match (&current, intent) {
        (VpnState::Idle { .. }, Intent::Start { mode })
        | (VpnState::Failed { .. }, Intent::Start { mode }) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Starting {
                since: now_secs(),
                epoch,
                mode,
            }
        }
        (VpnState::Starting { mode, .. }, Intent::MarkRunning) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Running {
                since: now_secs(),
                epoch,
                mode: mode.clone(),
            }
        }
        (VpnState::Running { .. }, Intent::Stop) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Stopping {
                since: now_secs(),
                epoch,
            }
        }
        (
            VpnState::Stopping { .. } | VpnState::Starting { .. } | VpnState::Running { .. },
            Intent::MarkIdle,
        ) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Idle { epoch }
        }
        (VpnState::Failed { .. }, Intent::ClearFailure) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Idle { epoch }
        }
        (VpnState::Stopping { .. }, Intent::RollbackToRunning { mode }) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Running {
                since: now_secs(),
                epoch,
                mode,
            }
        }
        (cur, Intent::Fail { reason }) if !matches!(cur, VpnState::Idle { .. }) => {
            let epoch = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            VpnState::Failed {
                reason,
                at: now_secs(),
                epoch,
            }
        }
        (cur, intent) => {
            let msg = format!("illegal transition from {} via {:?}", cur.kind(), intent);
            log::warn!("[vpn-state] {}", msg);
            return Err(msg);
        }
    };

    log::info!(
        "[vpn-state] {} -> {} (epoch={})",
        current.kind(),
        new_state.kind(),
        new_state.epoch()
    );

    *guard = new_state.clone();
    drop(guard);

    if let Err(e) = app.emit(EVENT_VPN_STATE, new_state.clone()) {
        log::error!("[vpn-state] emit {} failed: {}", EVENT_VPN_STATE, e);
    }

    Ok(new_state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_monotonic_bumps() {
        let cell = VpnStateCell::new();
        assert_eq!(cell.current_epoch(), 0);
        for i in 1..=3 {
            let e = cell.counter.fetch_add(1, Ordering::SeqCst) + 1;
            assert_eq!(e, i);
        }
        assert_eq!(cell.current_epoch(), 3);
    }

    #[test]
    fn snapshot_clones_state() {
        let cell = VpnStateCell::new();
        let s1 = cell.snapshot();
        assert!(matches!(s1, VpnState::Idle { epoch: 0 }));
        {
            let mut g = cell.inner.lock().unwrap();
            *g = VpnState::Running {
                since: 1,
                epoch: 42,
                mode: "tun".into(),
            };
        }
        let s2 = cell.snapshot();
        match s2 {
            VpnState::Running { epoch, .. } => assert_eq!(epoch, 42),
            _ => panic!("wrong variant"),
        }
        assert!(matches!(s1, VpnState::Idle { .. }));
    }

    #[test]
    fn state_kind_labels() {
        assert_eq!(VpnState::Idle { epoch: 0 }.kind(), "idle");
        assert_eq!(
            VpnState::Starting {
                since: 0,
                epoch: 1,
                mode: "tun".into()
            }
            .kind(),
            "starting"
        );
        assert_eq!(
            VpnState::Stopping { since: 0, epoch: 1 }.kind(),
            "stopping"
        );
        assert_eq!(
            VpnState::Failed {
                reason: "x".into(),
                at: 0,
                epoch: 1
            }
            .kind(),
            "failed"
        );
    }
}
