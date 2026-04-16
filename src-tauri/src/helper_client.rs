//! Rust-facing wrapper around the Objective-C XPC shim in `helper_client.m`.
//!
//! Phase 1b only ships `ping`. Real privileged operations migrate in later
//! phases, replacing the `echo 'PASSWORD' | sudo -S ...` paths in
//! `vpn/macos.rs`.
//!
//! On non-macOS targets the entire module degrades to stubs that return an
//! error, so the Tauri command can still be registered unconditionally.

#[cfg(target_os = "macos")]
mod ffi {
    use std::os::raw::{c_char, c_int};

    extern "C" {
        pub fn onebox_helper_ping(reply_out: *mut *mut c_char) -> c_int;
        pub fn onebox_helper_install(error_out: *mut *mut c_char) -> c_int;
        pub fn onebox_helper_free_string(s: *mut c_char);
    }
}

#[cfg(target_os = "macos")]
fn ping_impl() -> Result<String, String> {
    use std::ffi::CStr;
    use std::os::raw::c_char;
    use std::ptr;

    let mut reply: *mut c_char = ptr::null_mut();
    let rc = unsafe { ffi::onebox_helper_ping(&mut reply) };

    let message = if reply.is_null() {
        String::new()
    } else {
        let s = unsafe { CStr::from_ptr(reply).to_string_lossy().into_owned() };
        unsafe { ffi::onebox_helper_free_string(reply) };
        s
    };

    if rc == 0 {
        Ok(message)
    } else {
        Err(message)
    }
}

#[cfg(not(target_os = "macos"))]
fn ping_impl() -> Result<String, String> {
    Err("privileged helper is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn install_impl() -> Result<(), String> {
    use std::ffi::CStr;
    use std::os::raw::c_char;
    use std::ptr;

    let mut err: *mut c_char = ptr::null_mut();
    let rc = unsafe { ffi::onebox_helper_install(&mut err) };

    let message = if err.is_null() {
        String::new()
    } else {
        let s = unsafe { CStr::from_ptr(err).to_string_lossy().into_owned() };
        unsafe { ffi::onebox_helper_free_string(err) };
        s
    };

    if rc == 0 {
        Ok(())
    } else {
        Err(message)
    }
}

#[cfg(not(target_os = "macos"))]
fn install_impl() -> Result<(), String> {
    Err("privileged helper is only available on macOS".to_string())
}

#[tauri::command]
pub async fn helper_ping() -> Result<String, String> {
    tokio::task::spawn_blocking(ping_impl)
        .await
        .map_err(|e| format!("helper_ping join error: {}", e))?
}

#[tauri::command]
pub async fn helper_install() -> Result<(), String> {
    tokio::task::spawn_blocking(install_impl)
        .await
        .map_err(|e| format!("helper_install join error: {}", e))?
}
