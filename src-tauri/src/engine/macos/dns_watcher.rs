//! SCDynamicStore watcher: detect DNS changes outside the NetworkUp path.
//!
//! The NetworkUp lifecycle event (Wi-Fi switch, wake-from-sleep, DHCP renewal)
//! already re-triggers the TUN DNS override, but it's reactive to *link-level*
//! changes, not *DNS-config* changes. If the user runs `networksetup
//! -setdnsservers` by hand, edits DNS in System Settings, or another VPN/MDM
//! agent rewrites DNS mid-session, the override is silently lost until the
//! next link flap. This watcher closes that gap by listening to the macOS
//! SystemConfiguration dynamic store directly.
//!
//! Keys watched:
//!   - `(State|Setup):/Network/Service/.*/DNS` — any per-service DNS change.
//!     `Setup:` is where System Settings / `networksetup` commit user intent;
//!     `State:` is the live runtime value (DHCP push, our override, etc.).
//!     Watching both catches writes regardless of which layer changed first.
//!   - `State:/Network/Global/IPv4` — primary-service change. Fires when
//!     macOS promotes a different interface (Wi-Fi → Ethernet). Handled by
//!     the same `reapply_on_active_primary`, which compares the slot's
//!     `service` against the newly-detected primary and restores the old
//!     service before capturing + overriding the new one.
//!
//! Threading:
//!   - One dedicated thread started via `ensure_started()` (idempotent).
//!   - The thread owns the `SCDynamicStore` + CFRunLoop; `CFRunLoop::run`
//!     blocks forever. The watcher has no stop API — it stays idle (no-op
//!     callback) when `ACTIVE_OVERRIDE` is `None`.
//!
//! Self-write suppression:
//!   - The callback delegates to `reapply_on_active_primary`, which reads
//!     the current DNS via `networksetup -getdnsservers` and only re-writes
//!     when it differs from the stored gateway. Our own writes therefore
//!     surface as "already == gateway" and fast-path to a no-op.

use std::sync::OnceLock;

use core_foundation::array::CFArray;
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_foundation::string::CFString;
use system_configuration::dynamic_store::{
    SCDynamicStore, SCDynamicStoreBuilder, SCDynamicStoreCallBackContext,
};

use super::{active_override_snapshot, reapply_on_active_primary};

static STARTED: OnceLock<()> = OnceLock::new();

/// Start the watcher thread once per app lifetime. Subsequent calls are
/// no-ops. Safe to call from any thread.
pub fn ensure_started() {
    STARTED.get_or_init(|| {
        let builder = std::thread::Builder::new().name("onebox-dns-watcher".into());
        if let Err(e) = builder.spawn(watcher_thread_main) {
            log::warn!("[dns-watch] failed to spawn watcher thread: {}", e);
        } else {
            log::info!("[dns-watch] watcher thread spawned");
        }
    });
}

fn watcher_thread_main() {
    let ctx = SCDynamicStoreCallBackContext {
        callout: on_dynamic_store_change,
        info: (),
    };
    let Some(store) = SCDynamicStoreBuilder::new("cloud.oneoh.onebox.dns-watcher")
        .callback_context(ctx)
        .build()
    else {
        log::warn!("[dns-watch] SCDynamicStoreCreate failed, watcher disabled");
        return;
    };

    let watch_keys: CFArray<CFString> = CFArray::from_CFTypes(&[
        // Primary-service tracker; when the active interface changes this
        // key's dictionary gets rewritten.
        CFString::from_static_string("State:/Network/Global/IPv4"),
    ]);
    let watch_patterns: CFArray<CFString> = CFArray::from_CFTypes(&[
        // Per-service DNS change on either layer.
        CFString::from_static_string("(State|Setup):/Network/Service/.*/DNS"),
    ]);

    if !store.set_notification_keys(&watch_keys, &watch_patterns) {
        log::warn!("[dns-watch] set_notification_keys failed, watcher disabled");
        return;
    }

    let Some(run_loop_source) = store.create_run_loop_source() else {
        log::warn!("[dns-watch] create_run_loop_source failed, watcher disabled");
        return;
    };
    let run_loop = CFRunLoop::get_current();
    run_loop.add_source(&run_loop_source, unsafe { kCFRunLoopCommonModes });

    log::info!("[dns-watch] entering CFRunLoop");
    CFRunLoop::run_current();
    // CFRunLoop::run_current returns only if the loop is stopped externally,
    // which we never do. If it does return, the watcher is dead — log so the
    // next TUN start can at least see it in the logs.
    log::warn!("[dns-watch] CFRunLoop exited unexpectedly, watcher gone");
}

/// Callback fired on SCDynamicStore change. Signature required by the
/// `system-configuration` crate (see `SCDynamicStoreCallBackT`).
fn on_dynamic_store_change(
    _store: SCDynamicStore,
    changed_keys: CFArray<CFString>,
    _info: &mut (),
) {
    // Cheap early-out: if TUN isn't active, nothing to do. Avoids running
    // `route`/`networksetup` child processes on every system DNS twitch
    // (DHCP renewals, Bonjour state updates, etc.).
    let Some(active) = active_override_snapshot() else {
        return;
    };

    if log::log_enabled!(log::Level::Debug) {
        let joined: Vec<String> = changed_keys.iter().map(|k| k.to_string()).collect();
        log::debug!(
            "[dns-watch] change event: slot_service='{}' keys={:?}",
            active.service,
            joined
        );
    } else {
        log::info!(
            "[dns-watch] change event: slot_service='{}' keys_changed={}",
            active.service,
            changed_keys.len()
        );
    }

    // Delegate the full state-machine decision (same primary? re-override.
    // different primary? restore old + capture new.) to the shared entry
    // point. We pass the gateway from the slot so the callback doesn't need
    // access to the sing-box config path.
    if let Err(e) = reapply_on_active_primary(&active.gateway) {
        log::warn!("[dns-watch] reapply_on_active_primary failed: {}", e);
    }
}
