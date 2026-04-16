//! ServiceMain dispatcher for the OneBox TUN service.
//!
//! SCM invokes `service_main` with argv that includes the service arguments
//! passed by `StartServiceW` in the client. We parse:
//!   argv[0] = service name (ignored)
//!   argv[1] = sing-box config path
//!   argv[2] = TUN gateway IP (or "-" to skip DNS override)
//!   argv[3] = sing-box exe path
//!
//! Then apply DNS override, spawn sing-box, report SERVICE_RUNNING, and loop
//! on `child.try_wait()` + atomic stop flag at 200ms cadence. On stop/exit,
//! kill child (if alive), call `dns::restore_all()`, report SERVICE_STOPPED.

#![cfg(target_os = "windows")]
#![allow(dead_code)]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// `CREATE_NO_WINDOW` — passed via `CommandExt::creation_flags` to stop Windows
/// from allocating a visible console for console-subsystem children (sing-box).
/// Without this flag a service (which itself has no console) spawning a console
/// program causes Windows to pop a fresh console window on the user's desktop.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::System::Services::{
    RegisterServiceCtrlHandlerExW, SERVICE_ACCEPT_STOP, SERVICE_CONTROL_INTERROGATE,
    SERVICE_CONTROL_STOP, SERVICE_RUNNING, SERVICE_START_PENDING, SERVICE_STATUS,
    SERVICE_STATUS_CURRENT_STATE, SERVICE_STATUS_HANDLE, SERVICE_STOPPED, SERVICE_STOP_PENDING,
    SERVICE_TABLE_ENTRYW, SERVICE_WIN32_OWN_PROCESS, SetServiceStatus,
    StartServiceCtrlDispatcherW,
};

use crate::{dns, SERVICE_NAME};

/// Raw `SERVICE_STATUS_HANDLE.0` value stored as usize so it's trivially
/// Sync-safe across the handler callback and ServiceMain.
static STATUS_HANDLE_RAW: AtomicUsize = AtomicUsize::new(0);
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
static CHECKPOINT: AtomicUsize = AtomicUsize::new(0);

const ERROR_CALL_NOT_IMPLEMENTED: u32 = 120;
const NO_ERROR_U32: u32 = 0;

fn to_wide_z(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn status_handle() -> SERVICE_STATUS_HANDLE {
    SERVICE_STATUS_HANDLE(STATUS_HANDLE_RAW.load(Ordering::SeqCst) as *mut _)
}

fn set_state(state: SERVICE_STATUS_CURRENT_STATE, exit_code: u32, wait_hint_ms: u32) {
    let h = status_handle();
    if h.is_invalid() {
        return;
    }
    let accepts = if state == SERVICE_RUNNING {
        SERVICE_ACCEPT_STOP
    } else {
        0
    };
    let checkpoint = if state == SERVICE_RUNNING || state == SERVICE_STOPPED {
        0
    } else {
        let prev = CHECKPOINT.fetch_add(1, Ordering::SeqCst);
        (prev + 1) as u32
    };
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: accepts,
        dwWin32ExitCode: exit_code,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: checkpoint,
        dwWaitHint: wait_hint_ms,
    };
    unsafe {
        let _ = SetServiceStatus(h, &status);
    }
}

unsafe extern "system" fn handler_ex(
    control: u32,
    _event_type: u32,
    _event_data: *mut core::ffi::c_void,
    _ctx: *mut core::ffi::c_void,
) -> u32 {
    match control {
        c if c == SERVICE_CONTROL_STOP => {
            STOP_REQUESTED.store(true, Ordering::SeqCst);
            set_state(SERVICE_STOP_PENDING, 0, 5000);
            NO_ERROR_U32
        }
        c if c == SERVICE_CONTROL_INTERROGATE => NO_ERROR_U32,
        _ => ERROR_CALL_NOT_IMPLEMENTED,
    }
}

/// The SCM-invoked service entry point.
unsafe extern "system" fn service_main(argc: u32, argv: *mut PWSTR) {
    // Parse argv.
    let args: Vec<String> = (0..argc as isize)
        .map(|i| {
            let ptr = *argv.offset(i);
            if ptr.is_null() {
                String::new()
            } else {
                let mut len = 0usize;
                while *ptr.0.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(ptr.0, len);
                String::from_utf16_lossy(slice)
            }
        })
        .collect();

    // Register control handler.
    let name_w = to_wide_z(SERVICE_NAME);
    let handle = match RegisterServiceCtrlHandlerExW(
        PCWSTR(name_w.as_ptr()),
        Some(handler_ex),
        None,
    ) {
        Ok(h) => h,
        Err(e) => {
            dns::log_line(&format!("RegisterServiceCtrlHandlerExW failed: {}", e));
            return;
        }
    };
    STATUS_HANDLE_RAW.store(handle.0 as usize, Ordering::SeqCst);
    set_state(SERVICE_START_PENDING, 0, 5000);

    // argv[0] = service name; argv[1] = config; argv[2] = gateway; argv[3] = sing-box exe.
    if args.len() < 4 {
        dns::log_line(&format!(
            "service_main: expected 4 args, got {}: {:?}",
            args.len(),
            args
        ));
        set_state(SERVICE_STOPPED, 1, 0);
        return;
    }
    let config = args[1].clone();
    let gateway = args[2].clone();
    let sidecar = args[3].clone();

    dns::log_line(&format!(
        "service_main: config={} gateway={} sidecar={}",
        config, gateway, sidecar
    ));

    // Apply DNS override.
    let (ok, err) = dns::apply_override(&gateway);
    dns::log_line(&format!("apply_override: ok={} err={}", ok, err));

    // Flush the system resolver cache. On a reload (mode switch) the
    // previous config's entries — notably FakeIPs from global mode with
    // the 600s TTL baked into sing-box — would otherwise keep being
    // returned by the Dnscache service for up to 10 minutes. Running
    // this from SYSTEM context inside the service avoids the elevation
    // requirement that `ipconfig /flushdns` has when invoked by a user
    // process on Windows 10+.
    match std::process::Command::new("ipconfig")
        .arg("/flushdns")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(o) if o.status.success() => dns::log_line("ipconfig /flushdns OK"),
        Ok(o) => dns::log_line(&format!(
            "ipconfig /flushdns non-zero: {}",
            String::from_utf8_lossy(&o.stderr).trim()
        )),
        Err(e) => dns::log_line(&format!("ipconfig /flushdns spawn failed: {}", e)),
    }

    // Spawn sing-box. `CREATE_NO_WINDOW` is required — without it the service
    // (which has no console) spawning a console-subsystem child causes Windows
    // to pop a fresh terminal on the user's desktop.
    let mut child = match std::process::Command::new(&sidecar)
        .args(["run", "-c", &config, "--disable-color"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            dns::log_line(&format!("sing-box spawn failed: {}", e));
            let (r_ok, r_err) = dns::restore_all();
            dns::log_line(&format!("restore_all: ok={} err={}", r_ok, r_err));
            set_state(SERVICE_STOPPED, 1, 0);
            return;
        }
    };
    dns::log_line(&format!("sing-box spawned pid={}", child.id()));

    set_state(SERVICE_RUNNING, 0, 0);

    // Main loop: 200ms tick on child.try_wait() and STOP_REQUESTED.
    let mut unexpected_exit_code: Option<i32> = None;
    loop {
        if STOP_REQUESTED.load(Ordering::SeqCst) {
            dns::log_line("stop requested; killing child");
            let _ = child.kill();
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                dns::log_line(&format!("sing-box exited unexpectedly: {:?}", status));
                unexpected_exit_code = Some(status.code().unwrap_or(1));
                break;
            }
            Ok(None) => {}
            Err(e) => {
                dns::log_line(&format!("try_wait error: {}", e));
                let _ = child.kill();
                unexpected_exit_code = Some(1);
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    // Scorched-earth DNS restore.
    let (r_ok, r_err) = dns::restore_all();
    dns::log_line(&format!("restore_all: ok={} err={}", r_ok, r_err));

    let exit = unexpected_exit_code.unwrap_or(0) as u32;
    set_state(SERVICE_STOPPED, exit, 0);
}

/// Entry point for the service binary. Blocks in the SCM dispatcher until
/// the service exits. Returns 0 on success, 1 on dispatcher failure.
pub fn run_dispatcher() -> i32 {
    let mut name_w = to_wide_z(SERVICE_NAME);
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: PWSTR(name_w.as_mut_ptr()),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW {
            lpServiceName: PWSTR(std::ptr::null_mut()),
            lpServiceProc: None,
        },
    ];
    match unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) } {
        Ok(()) => 0,
        Err(e) => {
            dns::log_line(&format!("StartServiceCtrlDispatcherW failed: {}", e));
            1
        }
    }
}
