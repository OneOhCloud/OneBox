//! Rust-facing wrapper around the Objective-C XPC shim in `helper_client.m`.
//!
//! Phase 2b.1 adds wrappers for every helper capability that Phase 2b.2 will
//! use to replace the `echo '$PASSWORD' | sudo -S ...` paths in
//! `vpn/macos.rs`. Nothing in this file yet replaces an existing sudo call
//! — it's strictly additive so the migration can land in a separate step.
//!
//! All FFI boundary functions block the calling thread on an NSXPCConnection
//! round-trip (with a hard timeout). Tauri commands wrap every call in
//! `tokio::task::spawn_blocking` so the async runtime stays responsive.
//!
//! On non-macOS targets every function is a stub that returns an error.
//! Call sites can be gated on `cfg(target_os = "macos")`, or check the
//! returned error string.

// Phase 2b.1 adds the full helper API surface ahead of the vpn/macos.rs
// migration in Phase 2b.2. Until 2b.2 lands, most of these symbols have no
// Rust-side consumer — silence the dead_code noise at the module boundary
// rather than sprinkling #[allow] on every item.
#![allow(dead_code)]

#[cfg(target_os = "macos")]
mod ffi {
    use std::os::raw::{c_char, c_int};

    pub type ExitCallback = extern "C" fn(pid: c_int, exit_code: c_int);

    extern "C" {
        pub fn onebox_helper_ping(reply_out: *mut *mut c_char) -> c_int;
        pub fn onebox_helper_install(error_out: *mut *mut c_char) -> c_int;

        pub fn onebox_helper_start_sing_box(
            config_path: *const c_char,
            pid_out: *mut c_int,
            error_out: *mut *mut c_char,
        ) -> c_int;
        pub fn onebox_helper_stop_sing_box(error_out: *mut *mut c_char) -> c_int;
        pub fn onebox_helper_reload_sing_box(error_out: *mut *mut c_char) -> c_int;

        pub fn onebox_helper_set_ip_forwarding(
            enable: bool,
            error_out: *mut *mut c_char,
        ) -> c_int;
        pub fn onebox_helper_set_dns_servers(
            service_name: *const c_char,
            dns_spec: *const c_char,
            error_out: *mut *mut c_char,
        ) -> c_int;
        pub fn onebox_helper_flush_dns_cache(error_out: *mut *mut c_char) -> c_int;
        pub fn onebox_helper_remove_tun_routes(
            interface_name: *const c_char,
            error_out: *mut *mut c_char,
        ) -> c_int;

        pub fn onebox_helper_set_exit_callback(cb: ExitCallback);
        pub fn onebox_helper_free_string(s: *mut c_char);
    }
}

// ---------------------------------------------------------------------------
// Generic result helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn consume_cstring(ptr: *mut std::os::raw::c_char) -> String {
    use std::ffi::CStr;
    if ptr.is_null() {
        return String::new();
    }
    let s = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
    unsafe { ffi::onebox_helper_free_string(ptr) };
    s
}

#[cfg(target_os = "macos")]
fn call_error_only<F>(f: F) -> Result<(), String>
where
    F: FnOnce(*mut *mut std::os::raw::c_char) -> std::os::raw::c_int,
{
    use std::ptr;
    let mut err: *mut std::os::raw::c_char = ptr::null_mut();
    let rc = f(&mut err);
    let message = consume_cstring(err);
    if rc == 0 {
        Ok(())
    } else if message.is_empty() {
        Err(format!("helper call failed with rc={}", rc))
    } else {
        Err(message)
    }
}

// ---------------------------------------------------------------------------
// Exit-event bridge: helper → NSXPCConnection → client.exportedObject →
// `g_exit_callback` → Rust mpsc channel
// ---------------------------------------------------------------------------
//
// Phase 2b.2 will hook a receiver into `handle_process_termination`. For
// now the sender is stored in a OnceCell; `subscribe_exit_events()` installs
// the FFI callback on first call and returns a channel receiver.

#[cfg(target_os = "macos")]
mod exit_bridge {
    use super::ffi;
    use std::sync::{Mutex, OnceLock};
    use tokio::sync::mpsc;

    #[derive(Debug, Clone, Copy)]
    pub struct SingBoxExit {
        pub pid: i32,
        pub exit_code: i32,
    }

    static EXIT_SENDER: OnceLock<Mutex<Option<mpsc::UnboundedSender<SingBoxExit>>>> =
        OnceLock::new();

    extern "C" fn on_exit_trampoline(pid: std::os::raw::c_int, exit_code: std::os::raw::c_int) {
        log::info!(
            "[helper-client] sing-box exit event pid={} code={}",
            pid,
            exit_code
        );
        if let Some(lock) = EXIT_SENDER.get() {
            if let Ok(guard) = lock.lock() {
                if let Some(sender) = guard.as_ref() {
                    let _ = sender.send(SingBoxExit {
                        pid: pid as i32,
                        exit_code: exit_code as i32,
                    });
                }
            }
        }
    }

    /// Install the FFI callback once and return a receiver for exit events.
    /// Multiple calls replace the previous receiver — Phase 2b.2 will only
    /// call this from the startup path.
    pub fn subscribe() -> mpsc::UnboundedReceiver<SingBoxExit> {
        let (tx, rx) = mpsc::unbounded_channel();
        let slot = EXIT_SENDER.get_or_init(|| Mutex::new(None));
        {
            let mut guard = slot.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(tx);
        }
        unsafe { ffi::onebox_helper_set_exit_callback(on_exit_trampoline) };
        rx
    }
}

// Re-exported for Phase 2b.2 consumers (vpn/macos.rs, core.rs). Unused in
// this phase but kept public so 2b.2 can wire the receiver without further
// API churn.
#[cfg(target_os = "macos")]
#[allow(unused_imports)]
pub use exit_bridge::{subscribe as subscribe_sing_box_exits, SingBoxExit};

// ---------------------------------------------------------------------------
// Safe wrappers (macOS)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
pub mod api {
    use super::{call_error_only, consume_cstring, ffi};
    use std::ffi::CString;
    use std::ptr;

    fn to_cstring(s: &str, field: &str) -> Result<CString, String> {
        CString::new(s).map_err(|e| format!("{} contains NUL: {}", field, e))
    }

    pub fn ping() -> Result<String, String> {
        let mut reply: *mut std::os::raw::c_char = ptr::null_mut();
        let rc = unsafe { ffi::onebox_helper_ping(&mut reply) };
        let message = consume_cstring(reply);
        if rc == 0 {
            Ok(message)
        } else if message.is_empty() {
            Err(format!("helper ping failed with rc={}", rc))
        } else {
            Err(message)
        }
    }

    pub fn install() -> Result<(), String> {
        call_error_only(|err_out| unsafe { ffi::onebox_helper_install(err_out) })
    }

    pub fn start_sing_box(config_path: &str) -> Result<i32, String> {
        let c_path = to_cstring(config_path, "config_path")?;
        let mut pid: std::os::raw::c_int = 0;
        let mut err: *mut std::os::raw::c_char = ptr::null_mut();
        let rc = unsafe {
            ffi::onebox_helper_start_sing_box(c_path.as_ptr(), &mut pid, &mut err)
        };
        let message = consume_cstring(err);
        if rc == 0 && pid > 0 {
            Ok(pid as i32)
        } else if message.is_empty() {
            Err(format!("helper start_sing_box failed with rc={}", rc))
        } else {
            Err(message)
        }
    }

    pub fn stop_sing_box() -> Result<(), String> {
        call_error_only(|err_out| unsafe { ffi::onebox_helper_stop_sing_box(err_out) })
    }

    pub fn reload_sing_box() -> Result<(), String> {
        call_error_only(|err_out| unsafe { ffi::onebox_helper_reload_sing_box(err_out) })
    }

    pub fn set_ip_forwarding(enable: bool) -> Result<(), String> {
        call_error_only(|err_out| unsafe {
            ffi::onebox_helper_set_ip_forwarding(enable, err_out)
        })
    }

    pub fn set_dns_servers(service_name: &str, dns_spec: &str) -> Result<(), String> {
        let c_service = to_cstring(service_name, "service_name")?;
        let c_spec = to_cstring(dns_spec, "dns_spec")?;
        call_error_only(|err_out| unsafe {
            ffi::onebox_helper_set_dns_servers(c_service.as_ptr(), c_spec.as_ptr(), err_out)
        })
    }

    pub fn flush_dns_cache() -> Result<(), String> {
        call_error_only(|err_out| unsafe { ffi::onebox_helper_flush_dns_cache(err_out) })
    }

    pub fn remove_tun_routes(interface_name: &str) -> Result<(), String> {
        let c_iface = to_cstring(interface_name, "interface_name")?;
        call_error_only(|err_out| unsafe {
            ffi::onebox_helper_remove_tun_routes(c_iface.as_ptr(), err_out)
        })
    }
}

// ---------------------------------------------------------------------------
// Non-macOS stubs so call sites can compile on every platform
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "macos"))]
pub mod api {
    const MSG: &str = "privileged helper is only available on macOS";

    pub fn ping() -> Result<String, String> { Err(MSG.to_string()) }
    pub fn install() -> Result<(), String> { Err(MSG.to_string()) }
    pub fn start_sing_box(_config_path: &str) -> Result<i32, String> { Err(MSG.to_string()) }
    pub fn stop_sing_box() -> Result<(), String> { Err(MSG.to_string()) }
    pub fn reload_sing_box() -> Result<(), String> { Err(MSG.to_string()) }
    pub fn set_ip_forwarding(_enable: bool) -> Result<(), String> { Err(MSG.to_string()) }
    pub fn set_dns_servers(_service_name: &str, _dns_spec: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn flush_dns_cache() -> Result<(), String> { Err(MSG.to_string()) }
    pub fn remove_tun_routes(_interface_name: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (dev-only probes, no direct consumption yet)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn helper_ping() -> Result<String, String> {
    tokio::task::spawn_blocking(api::ping)
        .await
        .map_err(|e| format!("helper_ping join error: {}", e))?
}

#[tauri::command]
pub async fn helper_install() -> Result<(), String> {
    tokio::task::spawn_blocking(api::install)
        .await
        .map_err(|e| format!("helper_install join error: {}", e))?
}

