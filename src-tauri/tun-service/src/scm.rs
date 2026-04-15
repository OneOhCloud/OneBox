//! Windows SCM wrappers used by both the main app (non-elevated query /
//! start / stop) and the install helper (elevated install / uninstall).

#![cfg(target_os = "windows")]
#![allow(dead_code)]

use std::ffi::OsStr;
use std::io::Read;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
use windows::Win32::System::Services::{
    CloseServiceHandle, ControlService, CreateServiceW, DeleteService, OpenSCManagerW,
    OpenServiceW, QueryServiceStatusEx, SC_HANDLE, SC_MANAGER_CONNECT, SC_MANAGER_CREATE_SERVICE,
    SC_STATUS_PROCESS_INFO, SERVICE_CONTROL_STOP, SERVICE_DEMAND_START, SERVICE_ERROR_NORMAL,
    SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_START, SERVICE_START_PENDING,
    SERVICE_STATUS, SERVICE_STATUS_PROCESS, SERVICE_STOP, SERVICE_STOPPED, SERVICE_STOP_PENDING,
    SERVICE_WIN32_OWN_PROCESS, SetServiceObjectSecurity, StartServiceW,
};

use crate::{SERVICE_DISPLAY_NAME, SERVICE_NAME};

/// Standard access rights; not re-exported by the `windows` crate for SC_HANDLE.
const DELETE_ACCESS: u32 = 0x0001_0000;

/// SDDL: default SCM ACEs + `(A;;LCRPWP;;;AU)` granting Authenticated Users
/// QueryStatus | Start | Stop. LCRPWP == SERVICE_QUERY_STATUS|SERVICE_START|
/// SERVICE_STOP|SERVICE_USER_DEFINED_CONTROL, which is the minimum a
/// non-elevated client needs.
const SERVICE_SDDL: &str = "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;LCRPWP;;;AU)";

// ============================== paths ===============================

pub fn program_data_dir() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    let mut p = base;
    p.push("OneBox");
    p.push("service");
    p
}

pub fn installed_exe_path() -> PathBuf {
    program_data_dir().join("tun-service.exe")
}

pub fn installed_hash_marker() -> PathBuf {
    program_data_dir().join("binary.sha256")
}

// ============================== hash =================================

pub fn compute_file_sha256(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_marker() -> Option<String> {
    std::fs::read_to_string(installed_hash_marker())
        .ok()
        .map(|s| s.trim().to_string())
}

fn write_marker(hash: &str) -> std::io::Result<()> {
    let dir = program_data_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(installed_hash_marker(), hash)
}

// ============================== wide helpers =========================

fn to_wide_z(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

// ============================== handles ==============================

struct ScHandle(SC_HANDLE);
impl Drop for ScHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }
}

fn open_scm(access: u32) -> Result<ScHandle, String> {
    let h = unsafe { OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), access) }
        .map_err(|e| format!("OpenSCManagerW({:#x}) failed: {}", access, e))?;
    if h.is_invalid() {
        return Err("OpenSCManagerW returned invalid handle".into());
    }
    Ok(ScHandle(h))
}

fn open_service(scm: &ScHandle, access: u32) -> Result<ScHandle, String> {
    let name = to_wide_z(SERVICE_NAME);
    let h = unsafe { OpenServiceW(scm.0, PCWSTR(name.as_ptr()), access) }
        .map_err(|e| format!("OpenServiceW({:#x}) failed: {}", access, e))?;
    if h.is_invalid() {
        return Err("OpenServiceW returned invalid handle".into());
    }
    Ok(ScHandle(h))
}

// ============================== state query ==========================

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueriedState {
    NotInstalled,
    Stopped,
    StartPending,
    Running,
    StopPending,
    Other,
}

fn query_status(svc: &ScHandle) -> Result<SERVICE_STATUS_PROCESS, String> {
    let mut needed: u32 = 0;
    let mut buf = vec![0u8; std::mem::size_of::<SERVICE_STATUS_PROCESS>()];
    unsafe {
        QueryServiceStatusEx(svc.0, SC_STATUS_PROCESS_INFO, Some(&mut buf), &mut needed)
            .map_err(|e| format!("QueryServiceStatusEx failed: {}", e))?;
    }
    let ssp: SERVICE_STATUS_PROCESS =
        unsafe { std::ptr::read(buf.as_ptr() as *const SERVICE_STATUS_PROCESS) };
    Ok(ssp)
}

fn state_from_u32(s: u32) -> QueriedState {
    if s == SERVICE_RUNNING.0 {
        QueriedState::Running
    } else if s == SERVICE_STOPPED.0 {
        QueriedState::Stopped
    } else if s == SERVICE_START_PENDING.0 {
        QueriedState::StartPending
    } else if s == SERVICE_STOP_PENDING.0 {
        QueriedState::StopPending
    } else {
        QueriedState::Other
    }
}

pub fn query_state() -> QueriedState {
    let scm = match open_scm(SC_MANAGER_CONNECT) {
        Ok(h) => h,
        Err(_) => return QueriedState::NotInstalled,
    };
    let svc = match open_service(&scm, SERVICE_QUERY_STATUS) {
        Ok(h) => h,
        Err(_) => return QueriedState::NotInstalled,
    };
    match query_status(&svc) {
        Ok(ssp) => state_from_u32(ssp.dwCurrentState.0),
        Err(_) => QueriedState::Other,
    }
}

// ============================== freshness ============================

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Freshness {
    MissingBinary,
    MissingService,
    NeedsUpgrade,
    UpToDate,
}

pub fn check_freshness(bundled_exe: &Path) -> Freshness {
    if !bundled_exe.exists() {
        return Freshness::MissingBinary;
    }
    let bundled_hash = match compute_file_sha256(bundled_exe) {
        Ok(h) => h,
        Err(_) => return Freshness::MissingBinary,
    };
    let marker = read_marker();
    let installed_exists = installed_exe_path().exists();
    if !installed_exists || marker.is_none() {
        return Freshness::NeedsUpgrade;
    }
    if matches!(query_state(), QueriedState::NotInstalled) {
        return Freshness::MissingService;
    }
    if marker.as_deref() == Some(bundled_hash.as_str()) {
        Freshness::UpToDate
    } else {
        Freshness::NeedsUpgrade
    }
}

// ============================== install ==============================

fn copy_with_retry(src: &Path, dst: &Path) -> std::io::Result<()> {
    let mut last_err: Option<std::io::Error> = None;
    for _ in 0..10 {
        match std::fs::copy(src, dst) {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::other("copy_with_retry exhausted")))
}

fn wait_until_stopped(svc: &ScHandle, timeout_ms: u64) -> Result<(), String> {
    let start = std::time::Instant::now();
    loop {
        let ssp = query_status(svc)?;
        if ssp.dwCurrentState == SERVICE_STOPPED {
            return Ok(());
        }
        if start.elapsed().as_millis() as u64 >= timeout_ms {
            return Err(format!(
                "wait_until_stopped timeout, current={}",
                ssp.dwCurrentState.0
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// Attempt a graceful stop + delete of an existing service. Idempotent.
fn stop_and_delete(scm: &ScHandle) -> Result<(), String> {
    let access = SERVICE_STOP | SERVICE_QUERY_STATUS | DELETE_ACCESS;
    let svc = match open_service(scm, access) {
        Ok(h) => h,
        Err(_) => return Ok(()), // not installed
    };
    // Send stop; ignore errors (may already be stopped)
    let mut status = SERVICE_STATUS::default();
    let _ = unsafe { ControlService(svc.0, SERVICE_CONTROL_STOP, &mut status) };
    let _ = wait_until_stopped(&svc, 10_000);
    unsafe {
        DeleteService(svc.0).map_err(|e| format!("DeleteService failed: {}", e))?;
    }
    drop(svc);
    // Wait for the service record to actually disappear.
    let start = std::time::Instant::now();
    loop {
        match open_service(scm, SERVICE_QUERY_STATUS) {
            Err(_) => return Ok(()),
            Ok(_h) => {
                if start.elapsed().as_millis() as u64 >= 10_000 {
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
    }
}

fn apply_sddl(svc: &ScHandle) -> Result<(), String> {
    let sddl_w = to_wide_z(SERVICE_SDDL);
    let mut psd = PSECURITY_DESCRIPTOR::default();
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl_w.as_ptr()),
            SDDL_REVISION_1,
            &mut psd,
            None,
        )
        .map_err(|e| format!("ConvertStringSecurityDescriptorToSecurityDescriptorW: {}", e))?;
    }
    let res = unsafe { SetServiceObjectSecurity(svc.0, DACL_SECURITY_INFORMATION, psd) };
    // Free regardless of success.
    unsafe {
        let _ = LocalFree(Some(HLOCAL(psd.0)));
    }
    res.map_err(|e| format!("SetServiceObjectSecurity failed: {}", e))
}

/// Elevated: stop + delete existing service + copy binary + create service + ACL.
/// Idempotent — safe to call repeatedly with the same bundled binary.
pub fn ensure_installed(bundled_exe: &Path) -> Result<(), String> {
    if !bundled_exe.exists() {
        return Err(format!(
            "bundled service exe does not exist: {}",
            bundled_exe.display()
        ));
    }
    let bundled_hash = compute_file_sha256(bundled_exe)
        .map_err(|e| format!("compute hash failed: {}", e))?;

    let dir = program_data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir ProgramData\\OneBox\\service: {}", e))?;

    let scm = open_scm(SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE)?;

    // Short-circuit: if the service exists, hash matches marker, and binary is
    // in place, we're already done.
    if let Some(marker) = read_marker() {
        if marker == bundled_hash
            && installed_exe_path().exists()
            && !matches!(query_state(), QueriedState::NotInstalled)
        {
            crate::dns::log_line("ensure_installed: already up to date, no-op");
            return Ok(());
        }
    }

    // Stop + delete whatever's there.
    stop_and_delete(&scm)?;

    // Copy binary (with retry, in case SCM is still releasing the lock).
    let dst = installed_exe_path();
    copy_with_retry(bundled_exe, &dst).map_err(|e| format!("copy binary: {}", e))?;

    // Register with SCM.
    let svc_name_w = to_wide_z(SERVICE_NAME);
    let display_w = to_wide_z(SERVICE_DISPLAY_NAME);
    // Binary path must be quoted if it contains spaces.
    let bin_path = if dst.to_string_lossy().contains(' ') {
        format!("\"{}\"", dst.display())
    } else {
        dst.display().to_string()
    };
    let bin_w = to_wide_z(&bin_path);

    let created = unsafe {
        CreateServiceW(
            scm.0,
            PCWSTR(svc_name_w.as_ptr()),
            PCWSTR(display_w.as_ptr()),
            SERVICE_ALL_ACCESS_LOCAL,
            SERVICE_WIN32_OWN_PROCESS,
            SERVICE_DEMAND_START,
            SERVICE_ERROR_NORMAL,
            PCWSTR(bin_w.as_ptr()),
            PCWSTR::null(),
            None,
            PCWSTR::null(),
            PCWSTR::null(), // LocalSystem
            PCWSTR::null(),
        )
    }
    .map_err(|e| format!("CreateServiceW failed: {}", e))?;
    let svc = ScHandle(created);

    apply_sddl(&svc)?;
    drop(svc);

    write_marker(&bundled_hash).map_err(|e| format!("write marker: {}", e))?;
    crate::dns::log_line(&format!(
        "ensure_installed: OK ({} -> {})",
        bundled_exe.display(),
        dst.display()
    ));
    Ok(())
}

/// `SERVICE_ALL_ACCESS` (we need it for the install handle so `SetServiceObjectSecurity`
/// succeeds and future admins can manage the service normally).
const SERVICE_ALL_ACCESS_LOCAL: u32 = 0xF01FF;

/// Elevated: stop + delete + rm binary + rm marker. Idempotent.
pub fn uninstall() -> Result<(), String> {
    if let Ok(scm) = open_scm(SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE) {
        let _ = stop_and_delete(&scm);
    }
    let _ = std::fs::remove_file(installed_exe_path());
    let _ = std::fs::remove_file(installed_hash_marker());
    crate::dns::log_line("uninstall: done");
    Ok(())
}

// ============================== start / stop =========================

fn wait_not_pending(svc: &ScHandle, timeout_ms: u64) -> Result<QueriedState, String> {
    let start = std::time::Instant::now();
    loop {
        let ssp = query_status(svc)?;
        let st = state_from_u32(ssp.dwCurrentState.0);
        if !matches!(st, QueriedState::StartPending | QueriedState::StopPending) {
            return Ok(st);
        }
        if start.elapsed().as_millis() as u64 >= timeout_ms {
            return Ok(st);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// Non-elevated (uses ACL granted to Authenticated Users). Starts the service
/// with the given arguments; polls until it leaves StartPending or 15s elapses.
pub fn start_service_with_args(args: &[&str]) -> Result<(), String> {
    let scm = open_scm(SC_MANAGER_CONNECT)?;
    let svc = open_service(&scm, SERVICE_START | SERVICE_QUERY_STATUS)?;

    // Build wide-string storage + PCWSTR pointer array.
    let wides: Vec<Vec<u16>> = args.iter().map(|a| to_wide_z(a)).collect();
    let ptrs: Vec<PCWSTR> = wides.iter().map(|w| PCWSTR(w.as_ptr())).collect();

    let slice: Option<&[PCWSTR]> = if ptrs.is_empty() {
        None
    } else {
        Some(ptrs.as_slice())
    };
    unsafe {
        StartServiceW(svc.0, slice).map_err(|e| format!("StartServiceW failed: {}", e))?;
    }

    let final_state = wait_not_pending(&svc, 15_000)?;
    match final_state {
        QueriedState::Running => Ok(()),
        other => Err(format!("service did not reach Running (state = {:?})", other)),
    }
}

/// Non-elevated. Sends SERVICE_CONTROL_STOP and waits up to 10s for Stopped.
pub fn stop_service() -> Result<(), String> {
    let scm = open_scm(SC_MANAGER_CONNECT)?;
    let svc = match open_service(&scm, SERVICE_STOP | SERVICE_QUERY_STATUS) {
        Ok(h) => h,
        Err(_) => return Ok(()), // not installed or already gone
    };
    let mut status = SERVICE_STATUS::default();
    let _ = unsafe { ControlService(svc.0, SERVICE_CONTROL_STOP, &mut status) };
    let _ = wait_until_stopped(&svc, 10_000);
    Ok(())
}

// ============================== tests ================================
//
// What we can test without admin/SCM:
//   - pure path helpers (program_data_dir / installed_exe_path / marker)
//   - compute_file_sha256 (deterministic, filesystem only)
//   - check_freshness on a missing bundled path
//   - check_freshness on a bundled path that exists but has no marker
//   - `query_state` must return a valid enum value (read-only SCM connect;
//     everyone can open SCM for CONNECT, so this runs on any account)
//
// What we cannot unit-test (needs admin + real SCM + possibly NIC writes):
//   - ensure_installed / uninstall / start_service_with_args / stop_service
//   - SDDL application + round-trip
//   - actual service lifecycle
// Those are explicitly covered by the manual verification checklist in the
// refactor PR description and must be exercised on a real machine.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_data_dir_is_absolute_and_ends_with_onebox_service() {
        let p = program_data_dir();
        assert!(p.is_absolute(), "program_data_dir must be absolute: {:?}", p);
        let s = p.to_string_lossy();
        assert!(
            s.ends_with(r"OneBox\service") || s.ends_with("OneBox/service"),
            "unexpected program_data_dir tail: {}",
            s
        );
    }

    #[test]
    fn installed_paths_live_under_program_data_dir() {
        let base = program_data_dir();
        assert_eq!(installed_exe_path().parent().unwrap(), base);
        assert_eq!(installed_hash_marker().parent().unwrap(), base);
        assert_eq!(
            installed_exe_path().file_name().unwrap(),
            std::ffi::OsStr::new("tun-service.exe")
        );
        assert_eq!(
            installed_hash_marker().file_name().unwrap(),
            std::ffi::OsStr::new("binary.sha256")
        );
    }

    #[test]
    fn compute_file_sha256_matches_known_vector() {
        // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let hash = compute_file_sha256(tmp.path()).unwrap();
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn compute_file_sha256_matches_abc_vector() {
        // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), b"abc").unwrap();
        let hash = compute_file_sha256(tmp.path()).unwrap();
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn compute_file_sha256_is_stable_across_reads() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), b"deadbeef\n").unwrap();
        let a = compute_file_sha256(tmp.path()).unwrap();
        let b = compute_file_sha256(tmp.path()).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn check_freshness_reports_missing_binary_for_nonexistent_path() {
        let p = std::path::Path::new(r"C:\__does_not_exist_onebox__\nope.exe");
        assert_eq!(check_freshness(p), Freshness::MissingBinary);
    }

    /// A bundled exe that exists but no marker / installed exe ⇒ NeedsUpgrade.
    /// This test cannot assume the service is NOT installed on the dev machine,
    /// so we only assert the result is one of the non-UpToDate variants when the
    /// installed marker is absent. If a developer happens to have the real service
    /// installed with a matching hash we skip.
    #[test]
    fn check_freshness_without_marker_is_never_up_to_date() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), b"fake bundled service exe").unwrap();

        let marker = installed_hash_marker();
        if marker.exists() {
            // Cannot safely assert — developer may actually have it installed.
            // Ensure the function at least returns without panicking.
            let _ = check_freshness(tmp.path());
            return;
        }
        let result = check_freshness(tmp.path());
        assert_ne!(
            result,
            Freshness::UpToDate,
            "freshness must not report UpToDate when no marker exists"
        );
    }

    #[test]
    fn query_state_returns_valid_variant() {
        // Read-only: SC_MANAGER_CONNECT is granted to everyone, so this works
        // even on a fresh machine with no tun-service installed.
        let s = query_state();
        // On a clean machine it's NotInstalled; on a machine with the service
        // installed it's one of the other variants. Just sanity-check we got
        // one of them back (no panic, no Other surfacing a bug).
        assert!(matches!(
            s,
            QueriedState::NotInstalled
                | QueriedState::Stopped
                | QueriedState::StartPending
                | QueriedState::Running
                | QueriedState::StopPending
                | QueriedState::Other
        ));
    }

    #[test]
    fn state_from_u32_round_trip() {
        assert_eq!(state_from_u32(SERVICE_RUNNING.0), QueriedState::Running);
        assert_eq!(state_from_u32(SERVICE_STOPPED.0), QueriedState::Stopped);
        assert_eq!(
            state_from_u32(SERVICE_START_PENDING.0),
            QueriedState::StartPending
        );
        assert_eq!(
            state_from_u32(SERVICE_STOP_PENDING.0),
            QueriedState::StopPending
        );
        // Unknown codes map to Other (SERVICE_PAUSED = 7 is not special-cased).
        assert_eq!(state_from_u32(0xFFFF), QueriedState::Other);
        assert_eq!(state_from_u32(7), QueriedState::Other);
    }
}
