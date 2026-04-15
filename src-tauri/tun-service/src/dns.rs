//! DNS override primitives — ported from `vpn/windows_native.rs` so the service
//! can run them in its own process without depending on the main app crate.
//!
//! All functions write to `HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\
//! Parameters\Interfaces\{GUID}\NameServer` via raw `windows` crate calls.
//! Identical scorched-earth semantics to the elevated helper: enumerate, match
//! by shape, reset everything that isn't TUN-ish.

#![cfg(target_os = "windows")]
#![allow(dead_code)]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_SAM_FLAGS, REG_SZ, REG_VALUE_TYPE,
};

pub const TCPIP_INTERFACES: &str =
    r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces";
pub const NET_CLASS_GUID: &str = "{4D36E972-E325-11CE-BFC1-08002BE10318}";

// =========================== pure helpers =============================

pub fn normalize_guid(s: &str) -> Option<String> {
    let t = s.trim();
    let inner = t.trim_start_matches('{').trim_end_matches('}');
    if inner.len() != 36 {
        return None;
    }
    let bytes = inner.as_bytes();
    if bytes[8] != b'-' || bytes[13] != b'-' || bytes[18] != b'-' || bytes[23] != b'-' {
        return None;
    }
    if !inner.chars().all(|c| c == '-' || c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("{{{}}}", inner.to_ascii_uppercase()))
}

pub fn interface_reg_path(guid: &str) -> String {
    format!(r"{}\{}", TCPIP_INTERFACES, guid)
}

pub fn connection_reg_path(guid: &str) -> String {
    format!(
        r"SYSTEM\CurrentControlSet\Control\Network\{}\{}\Connection",
        NET_CLASS_GUID, guid
    )
}

pub fn is_tun_alias(alias: &str) -> bool {
    let lc = alias.to_ascii_lowercase();
    lc.contains("sing-box")
        || lc.contains("wintun")
        || lc.contains("utun")
        || lc.contains("tap-windows")
        || lc.contains("onebox")
}

pub fn format_nameserver_value(servers: &[&str]) -> String {
    servers
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

pub fn has_nonzero_ip(raw: &str) -> bool {
    raw.split(['\0', ' ', ','])
        .any(|s| !s.is_empty() && s != "0.0.0.0")
}

// =========================== Win32 helpers =============================

fn to_wide_z(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn from_wide_lossy(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

struct RegKey(HKEY);

impl Drop for RegKey {
    fn drop(&mut self) {
        if self.0 .0 as usize != 0 {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }
}

fn open_key(root: HKEY, path: &str, access: REG_SAM_FLAGS) -> Result<RegKey, String> {
    let w = to_wide_z(path);
    let mut h = HKEY(ptr::null_mut());
    let rc = unsafe { RegOpenKeyExW(root, PCWSTR(w.as_ptr()), Some(0), access, &mut h) };
    if rc != ERROR_SUCCESS {
        return Err(format!("RegOpenKeyExW({}) failed: {:?}", path, rc.0));
    }
    Ok(RegKey(h))
}

fn query_string_value(key: &RegKey, name: &str) -> Option<String> {
    let wname = to_wide_z(name);
    let mut ty = REG_VALUE_TYPE::default();
    let mut size: u32 = 0;
    let rc = unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(wname.as_ptr()),
            None,
            Some(&mut ty),
            None,
            Some(&mut size),
        )
    };
    if rc != ERROR_SUCCESS || size == 0 {
        return None;
    }
    let mut buf = vec![0u8; size as usize];
    let rc = unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(wname.as_ptr()),
            None,
            Some(&mut ty),
            Some(buf.as_mut_ptr()),
            Some(&mut size),
        )
    };
    if rc != ERROR_SUCCESS {
        return None;
    }
    let u16_len = (size as usize) / 2;
    let wide: Vec<u16> = (0..u16_len)
        .map(|i| u16::from_le_bytes([buf[i * 2], buf[i * 2 + 1]]))
        .collect();
    Some(from_wide_lossy(&wide))
}

fn set_string_value(key: &RegKey, name: &str, value: &str) -> Result<(), String> {
    let wname = to_wide_z(name);
    let wvalue = to_wide_z(value);
    let bytes: &[u8] =
        unsafe { std::slice::from_raw_parts(wvalue.as_ptr() as *const u8, wvalue.len() * 2) };
    let rc =
        unsafe { RegSetValueExW(key.0, PCWSTR(wname.as_ptr()), Some(0), REG_SZ, Some(bytes)) };
    if rc != ERROR_SUCCESS {
        return Err(format!("RegSetValueExW({}) failed: {:?}", name, rc.0));
    }
    Ok(())
}

fn enum_subkey_names(key: &RegKey) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut idx: u32 = 0;
    loop {
        let mut buf = [0u16; 256];
        let mut len: u32 = buf.len() as u32;
        let rc = unsafe {
            RegEnumKeyExW(
                key.0,
                idx,
                Some(PWSTR(buf.as_mut_ptr())),
                &mut len,
                None,
                None,
                None,
                None,
            )
        };
        if rc == ERROR_NO_MORE_ITEMS {
            break;
        }
        if rc != ERROR_SUCCESS {
            return Err(format!("RegEnumKeyExW failed: {:?}", rc.0));
        }
        out.push(from_wide_lossy(&buf[..len as usize]));
        idx += 1;
    }
    Ok(out)
}

// =========================== public API =============================

#[derive(Debug, Clone)]
pub struct InterfaceInfo {
    pub guid: String,
    pub alias: String,
    pub has_ip: bool,
    pub current_dns: String,
}

impl InterfaceInfo {
    pub fn is_candidate_for_dns_override(&self) -> bool {
        self.has_ip && !is_tun_alias(&self.alias)
    }
}

pub fn enumerate_interfaces() -> Result<Vec<InterfaceInfo>, String> {
    let root = open_key(HKEY_LOCAL_MACHINE, TCPIP_INTERFACES, KEY_READ)?;
    let guids = enum_subkey_names(&root)?;
    let mut out = Vec::new();
    for guid in guids {
        if !guid.starts_with('{') {
            continue;
        }
        let iface_key =
            match open_key(HKEY_LOCAL_MACHINE, &interface_reg_path(&guid), KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };
        let dns = query_string_value(&iface_key, "NameServer").unwrap_or_default();
        let ip = query_string_value(&iface_key, "IPAddress").unwrap_or_default();
        let dhcp_ip = query_string_value(&iface_key, "DhcpIPAddress").unwrap_or_default();
        let has_ip = has_nonzero_ip(&ip) || has_nonzero_ip(&dhcp_ip);

        let alias = open_key(HKEY_LOCAL_MACHINE, &connection_reg_path(&guid), KEY_READ)
            .ok()
            .and_then(|k| query_string_value(&k, "Name"))
            .unwrap_or_default();

        out.push(InterfaceInfo {
            guid,
            alias,
            has_ip,
            current_dns: dns,
        });
    }
    Ok(out)
}

pub fn set_interface_dns(guid: &str, servers: &[&str]) -> Result<(), String> {
    let key = open_key(HKEY_LOCAL_MACHINE, &interface_reg_path(guid), KEY_SET_VALUE)?;
    let value = format_nameserver_value(servers);
    set_string_value(&key, "NameServer", &value)
}

pub fn reset_interface_dns(guid: &str) -> Result<(), String> {
    let key = open_key(HKEY_LOCAL_MACHINE, &interface_reg_path(guid), KEY_SET_VALUE)?;
    set_string_value(&key, "NameServer", "")
}

pub fn reset_all_interfaces_dns() -> (usize, usize) {
    let mut ok = 0usize;
    let mut err = 0usize;
    let list = match enumerate_interfaces() {
        Ok(l) => l,
        Err(e) => {
            log_line(&format!("enumerate_interfaces failed: {}", e));
            return (0, 0);
        }
    };
    for it in list {
        if is_tun_alias(&it.alias) {
            continue;
        }
        match reset_interface_dns(&it.guid) {
            Ok(()) => ok += 1,
            Err(e) => {
                log_line(&format!("reset {} ({}): {}", it.guid, it.alias, e));
                err += 1;
            }
        }
    }
    (ok, err)
}

/// Apply DNS override on all non-TUN interfaces with an IP. Idempotent.
/// Returns `(ok_count, err_count)`. An empty or `"-"` gateway is a no-op.
pub fn apply_override(gateway: &str) -> (usize, usize) {
    let g = gateway.trim();
    if g.is_empty() || g == "-" {
        return (0, 0);
    }
    let list = match enumerate_interfaces() {
        Ok(l) => l,
        Err(e) => {
            log_line(&format!("apply_override: enumerate failed: {}", e));
            return (0, 1);
        }
    };
    let mut ok = 0usize;
    let mut err = 0usize;
    for it in list {
        if !it.is_candidate_for_dns_override() {
            continue;
        }
        match set_interface_dns(&it.guid, &[g]) {
            Ok(()) => {
                log_line(&format!(
                    "dns override {} ({}) -> {}",
                    it.guid, it.alias, g
                ));
                ok += 1;
            }
            Err(e) => {
                log_line(&format!(
                    "dns override {} ({}) FAILED: {}",
                    it.guid, it.alias, e
                ));
                err += 1;
            }
        }
    }
    (ok, err)
}

/// Alias for `reset_all_interfaces_dns` — scorched-earth restore of all
/// non-TUN interfaces' NameServer values.
pub fn restore_all() -> (usize, usize) {
    reset_all_interfaces_dns()
}

// =========================== service log =============================

/// Append a line to `%PROGRAMDATA%\OneBox\service\service.log`, falling back to
/// `%TEMP%\onebox-service.log` if ProgramData is not writable. Silently ignores
/// errors (failed logging must never kill the service).
pub fn log_line(msg: &str) {
    use std::io::Write;
    let path = match std::env::var_os("ProgramData") {
        Some(pd) => {
            let mut p = std::path::PathBuf::from(pd);
            p.push("OneBox");
            p.push("service");
            let _ = std::fs::create_dir_all(&p);
            p.push("service.log");
            p
        }
        None => std::env::temp_dir().join("onebox-service.log"),
    };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "[{}] {}", stamp(), msg);
    }
}

fn stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "?".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------ normalize_guid ------------------------------

    #[test]
    fn normalize_guid_accepts_unbraced_and_uppercases() {
        assert_eq!(
            normalize_guid("550e8400-e29b-41d4-a716-446655440000"),
            Some("{550E8400-E29B-41D4-A716-446655440000}".to_string())
        );
    }

    #[test]
    fn normalize_guid_accepts_braced_form() {
        assert_eq!(
            normalize_guid("{550e8400-e29b-41d4-a716-446655440000}"),
            Some("{550E8400-E29B-41D4-A716-446655440000}".to_string())
        );
    }

    #[test]
    fn normalize_guid_rejects_garbage() {
        assert!(normalize_guid("").is_none());
        assert!(normalize_guid("bad").is_none());
        assert!(normalize_guid("550e8400-e29b-41d4-a716-44665544000Z").is_none());
        assert!(normalize_guid("550e8400e29b41d4a716446655440000").is_none());
        assert!(normalize_guid("550e8400-e29b-41d4-a716-4466554").is_none());
    }

    // ------------------------------ is_tun_alias -------------------------------

    #[test]
    fn tun_alias_detects_known_tun_adapters() {
        assert!(is_tun_alias("sing-box"));
        assert!(is_tun_alias("sing-box tun"));
        assert!(is_tun_alias("WinTUN Userspace Tunnel"));
        assert!(is_tun_alias("wintun"));
        assert!(is_tun_alias("TAP-Windows Adapter V9"));
        assert!(is_tun_alias("OneBox TUN"));
        assert!(is_tun_alias("utun0"));
    }

    #[test]
    fn tun_alias_is_case_insensitive() {
        assert!(is_tun_alias("WINTUN"));
        assert!(is_tun_alias("SING-BOX"));
    }

    #[test]
    fn tun_alias_skips_physical_adapters() {
        assert!(!is_tun_alias("Wi-Fi"));
        assert!(!is_tun_alias("Ethernet"));
        assert!(!is_tun_alias("以太网"));
        assert!(!is_tun_alias("Local Area Connection"));
    }

    // ------------------------------ nameserver format -------------------------

    #[test]
    fn nameserver_format_joins_and_trims() {
        assert_eq!(
            format_nameserver_value(&["1.1.1.1", " 2.2.2.2 "]),
            "1.1.1.1,2.2.2.2"
        );
    }

    #[test]
    fn nameserver_format_drops_empty_entries() {
        assert_eq!(format_nameserver_value(&[]), "");
        assert_eq!(format_nameserver_value(&["", "  "]), "");
        assert_eq!(format_nameserver_value(&["", "8.8.8.8", ""]), "8.8.8.8");
    }

    // ------------------------------ has_nonzero_ip ----------------------------

    #[test]
    fn has_nonzero_ip_rejects_blank_and_zeros() {
        assert!(!has_nonzero_ip(""));
        assert!(!has_nonzero_ip("0.0.0.0"));
        assert!(!has_nonzero_ip("0.0.0.0\0"));
        assert!(!has_nonzero_ip("0.0.0.0 0.0.0.0"));
    }

    #[test]
    fn has_nonzero_ip_accepts_real_addresses() {
        assert!(has_nonzero_ip("192.168.1.2"));
        // Registry multi-sz values may have embedded NULs.
        assert!(has_nonzero_ip("0.0.0.0\u{0}192.168.1.2"));
        assert!(has_nonzero_ip("10.0.0.1,8.8.8.8"));
    }

    // ------------------------------ path helpers ------------------------------

    #[test]
    fn interface_reg_path_matches_expected_shape() {
        let p = interface_reg_path("{ABC}");
        assert!(p.ends_with(r"Interfaces\{ABC}"));
        assert!(p.starts_with("SYSTEM"));
    }

    #[test]
    fn connection_reg_path_uses_net_class_guid() {
        let p = connection_reg_path("{XYZ}");
        assert!(p.contains(NET_CLASS_GUID));
        assert!(p.ends_with(r"\{XYZ}\Connection"));
    }

    // ------------------------------ apply_override noop ----------------------

    #[test]
    fn apply_override_with_empty_gateway_is_noop() {
        // Must not touch the registry when gateway is blank.
        assert_eq!(apply_override(""), (0, 0));
        assert_eq!(apply_override("-"), (0, 0));
        assert_eq!(apply_override("  "), (0, 0));
    }

    // ------------------------------ enumerate integration --------------------

    /// Read-only registry access; safe on any dev machine.
    #[test]
    fn enumerate_interfaces_returns_something_on_real_host() {
        let list = enumerate_interfaces().expect("enumerate");
        assert!(
            !list.is_empty(),
            "expected at least one Tcpip interface entry"
        );
        assert!(
            list.iter().any(|i| !i.alias.is_empty()),
            "expected at least one interface with a friendly name"
        );
    }
}
