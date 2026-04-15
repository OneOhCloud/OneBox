//! Windows 原生 DNS 覆写 / 提权 / 网卡枚举 —— 替换 PowerShell 脚本方案的底层实现。
//!
//! 设计目标：
//! - DNS 覆写全部走注册表 `HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{GUID}`
//!   的 `NameServer` 值，对应恢复时写入空串 —— Windows 在 DNS client 下次查询时会
//!   回落到 `DhcpNameServer`，等价于 `Set-DnsClientServerAddress -ResetServerAddresses`
//!   的"回到 DHCP 默认"语义。符合 CLAUDE.md 第 5 条"system-native semantics"。
//! - 网卡枚举完全通过注册表(`Tcpip\...\Interfaces\*` 子键 = GUID;alias 取
//!   `Control\Network\{4D36E972-...}\{GUID}\Connection\Name`),无需 IP Helper API,
//!   features 只需 `Win32_System_Registry`。
//! - 提权仅用一次 `ShellExecuteExW` + `runas` verb,对自身 exe 传入子命令参数,
//!   由子进程在 elevated 上下文里直调本文件里的注册表函数完成 DNS + sing-box 启停。

#![cfg(target_os = "windows")]
#![allow(dead_code)]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_SAM_FLAGS, REG_SZ, REG_VALUE_TYPE,
};
use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};

// ================= 常量 =================

pub const TCPIP_INTERFACES: &str = r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces";
pub const NET_CLASS_GUID: &str = "{4D36E972-E325-11CE-BFC1-08002BE10318}";

// ================= 纯函数(无 Win32 依赖,可离线测试) =================

/// 规范化 GUID 为 `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` 形式;输入非法返回 None。
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

/// 构造某个 GUID 对应的 Tcpip\Interfaces 子键路径。
pub fn interface_reg_path(guid: &str) -> String {
    format!(r"{}\{}", TCPIP_INTERFACES, guid)
}

/// 构造某个 GUID 对应的 Net class Connection 子键路径(读 friendly name 用)。
pub fn connection_reg_path(guid: &str) -> String {
    format!(
        r"SYSTEM\CurrentControlSet\Control\Network\{}\{}\Connection",
        NET_CLASS_GUID, guid
    )
}

/// 判断某个网卡 alias 是否是我们自己或第三方 TUN 适配器,用于跳过。
pub fn is_tun_alias(alias: &str) -> bool {
    let lc = alias.to_ascii_lowercase();
    lc.contains("sing-box")
        || lc.contains("wintun")
        || lc.contains("utun")
        || lc.contains("tap-windows")
        || lc.contains("onebox")
}

/// 把 DNS server 列表转换成 NameServer 注册表值要的逗号分隔字符串。
pub fn format_nameserver_value(servers: &[&str]) -> String {
    servers
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

/// 判定 `IPAddress` / `DhcpIPAddress` 值里是否有有效地址。
pub fn has_nonzero_ip(raw: &str) -> bool {
    raw.split(['\0', ' ', ','])
        .any(|s| !s.is_empty() && s != "0.0.0.0")
}

// ================= Win32 辅助 =================

fn to_wide_z(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn from_wide_lossy(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// RAII 包装:持有一个打开的 HKEY,析构时关闭。
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

/// 读取一个字符串值(REG_SZ / REG_EXPAND_SZ / REG_MULTI_SZ 都按 UTF-16 处理)。
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

/// 写入 REG_SZ 字符串值。Windows 约定字符串值带结尾 NUL,数据长度 = (utf16_len + 1) * 2。
fn set_string_value(key: &RegKey, name: &str, value: &str) -> Result<(), String> {
    let wname = to_wide_z(name);
    let wvalue = to_wide_z(value);
    let bytes: &[u8] =
        unsafe { std::slice::from_raw_parts(wvalue.as_ptr() as *const u8, wvalue.len() * 2) };
    let rc = unsafe { RegSetValueExW(key.0, PCWSTR(wname.as_ptr()), Some(0), REG_SZ, Some(bytes)) };
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

// ================= 对外 API =================

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

/// 枚举所有网卡,读 GUID + alias + IP 状态 + 当前 NameServer。
pub fn enumerate_interfaces() -> Result<Vec<InterfaceInfo>, String> {
    let root = open_key(HKEY_LOCAL_MACHINE, TCPIP_INTERFACES, KEY_READ)?;
    let guids = enum_subkey_names(&root)?;
    let mut out = Vec::new();
    for guid in guids {
        if !guid.starts_with('{') {
            continue;
        }
        let iface_key = match open_key(HKEY_LOCAL_MACHINE, &interface_reg_path(&guid), KEY_READ) {
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

/// 把指定 GUID 网卡的 NameServer 设置为 `servers`(逗号分隔),需管理员权限。
pub fn set_interface_dns(guid: &str, servers: &[&str]) -> Result<(), String> {
    let key = open_key(HKEY_LOCAL_MACHINE, &interface_reg_path(guid), KEY_SET_VALUE)?;
    let value = format_nameserver_value(servers);
    set_string_value(&key, "NameServer", &value)
}

/// 清空指定 GUID 网卡的 NameServer(写入空串),恢复 DHCP 下发的 DNS。
pub fn reset_interface_dns(guid: &str) -> Result<(), String> {
    let key = open_key(HKEY_LOCAL_MACHINE, &interface_reg_path(guid), KEY_SET_VALUE)?;
    set_string_value(&key, "NameServer", "")
}

/// 对所有非 TUN 非 loopback 的网卡执行 `reset_interface_dns`(idempotent / scorched-earth)。
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

// ================= 参数引用转义 =================

/// 按 Microsoft CommandLineToArgvW 约定转义单个参数。
pub fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"', '\\']) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => {
                backslashes += 1;
            }
            '"' => {
                for _ in 0..backslashes * 2 + 1 {
                    out.push('\\');
                }
                backslashes = 0;
                out.push('"');
            }
            _ => {
                for _ in 0..backslashes {
                    out.push('\\');
                }
                backslashes = 0;
                out.push(c);
            }
        }
    }
    for _ in 0..backslashes * 2 {
        out.push('\\');
    }
    out.push('"');
    out
}

/// 把一组参数拼成 lpParameters 字符串(空格分隔,每个 arg 用 quote_arg 转义)。
pub fn join_args(args: &[&str]) -> String {
    args.iter()
        .map(|a| quote_arg(a))
        .collect::<Vec<_>>()
        .join(" ")
}

// ================= 提权 =================

/// 用 `ShellExecuteExW` + `runas` verb 以管理员身份启动 `file` 并传入 `params`。
/// 等待 elevated 子进程退出并返回其 exit code；`None` 表示 ShellExecuteExW 未返回
/// 进程句柄（例如目标是 MSI / 已安装的快捷方式路径）。
pub fn shell_execute_runas(file: &str, params: &str) -> Result<Option<u32>, String> {
    let file_w = to_wide_z(file);
    let params_w = to_wide_z(params);
    let verb_w = to_wide_z("runas");

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb_w.as_ptr()),
        lpFile: PCWSTR(file_w.as_ptr()),
        lpParameters: PCWSTR(params_w.as_ptr()),
        nShow: 0, // SW_HIDE
        ..SHELLEXECUTEINFOW::default()
    };

    unsafe { ShellExecuteExW(&mut info) }.map_err(|e| format!("ShellExecuteExW failed: {}", e))?;
    if info.hProcess.is_invalid() {
        return Ok(None);
    }
    unsafe {
        let wait = WaitForSingleObject(info.hProcess, INFINITE);
        if wait != WAIT_OBJECT_0 {
            let _ = CloseHandle(info.hProcess);
            return Err(format!("WaitForSingleObject returned {:?}", wait));
        }
        let mut code: u32 = 0;
        let res = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        res.map_err(|e| format!("GetExitCodeProcess failed: {}", e))?;
        Ok(Some(code))
    }
}

/// 以管理员身份重新启动当前 exe,附带 `args`(已转义好的字符串)。
/// 等待 elevated helper 退出（关键：install-service 流程依赖同步返回）。
pub fn self_elevate(args: &str) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("current_exe: {}", e))?
        .to_string_lossy()
        .into_owned();
    let exit = shell_execute_runas(&exe, args)?;
    if let Some(code) = exit {
        if code != 0 {
            log_line(&format!("self_elevate: helper exit code = {}", code));
        }
    }
    Ok(())
}

/// 以管理员身份启动当前 exe 进入 helper 子命令模式。
pub fn self_elevate_helper(sub: &str, extra: &[&str]) -> Result<(), String> {
    let mut parts: Vec<&str> = vec!["--onebox-tun-helper", sub];
    parts.extend_from_slice(extra);
    let params = join_args(&parts);
    self_elevate(&params)
}

// ================= Helper 子进程入口 =================

/// `OneBox.exe --onebox-tun-helper <sub> [args]` 的分发函数。
/// 在 lib.rs::run() 开头被调用,跑完直接 exit,不进入 tauri runtime。
///
/// 子命令:
///   start <sidecar> <config> <gateway|->
///     gateway == "-" 时跳过 DNS 覆写;否则枚举非 TUN 网卡逐个写 NameServer。
///     DNS 写完后 spawn sing-box 并 detach(不等退出)。
///   stop
///     按"先恢复 DNS 再杀进程"的顺序:reset_all_interfaces_dns → taskkill sing-box.exe。
///   restore-dns
///     只做 DNS scorched-earth reset,用于崩溃兜底。
pub fn run_helper(args: &[String]) -> i32 {
    match args.first().map(|s| s.as_str()) {
        Some("start") => helper_start(&args[1..]),
        Some("stop") => helper_stop(),
        Some("restore-dns") => {
            let (ok, err) = reset_all_interfaces_dns();
            log_line(&format!("restore-dns: ok={} err={}", ok, err));
            0
        }
        Some("install-service") => {
            let bundled = match args.get(1) {
                Some(p) => p.clone(),
                None => {
                    log_line("install-service: missing bundled exe path");
                    return 2;
                }
            };
            match tun_service::scm::ensure_installed(std::path::Path::new(&bundled)) {
                Ok(()) => {
                    log_line(&format!("install-service: OK ({})", bundled));
                    0
                }
                Err(e) => {
                    log_line(&format!("install-service FAILED: {}", e));
                    1
                }
            }
        }
        Some("uninstall-service") => match tun_service::scm::uninstall() {
            Ok(()) => {
                log_line("uninstall-service: OK");
                0
            }
            Err(e) => {
                log_line(&format!("uninstall-service FAILED: {}", e));
                1
            }
        },
        other => {
            log_line(&format!("helper: unknown subcommand {:?}", other));
            2
        }
    }
}

fn helper_start(args: &[String]) -> i32 {
    if args.len() < 3 {
        log_line("helper start: need <sidecar> <config> <gateway|->");
        return 2;
    }
    let sidecar = &args[0];
    let cfg = &args[1];
    let gateway = &args[2];

    if gateway != "-" && !gateway.is_empty() {
        match enumerate_interfaces() {
            Ok(list) => {
                for it in list {
                    if !it.is_candidate_for_dns_override() {
                        continue;
                    }
                    match set_interface_dns(&it.guid, &[gateway.as_str()]) {
                        Ok(()) => log_line(&format!(
                            "dns override {} ({}) -> {}",
                            it.guid, it.alias, gateway
                        )),
                        Err(e) => log_line(&format!(
                            "dns override {} ({}) FAILED: {}",
                            it.guid, it.alias, e
                        )),
                    }
                }
            }
            Err(e) => log_line(&format!("enumerate_interfaces failed: {}", e)),
        }
    } else {
        log_line("dns override skipped (empty gateway)");
    }

    log_line(&format!("spawning sing-box: {} run -c {}", sidecar, cfg));
    match std::process::Command::new(sidecar)
        .args(["run", "-c", cfg.as_str(), "--disable-color"])
        .spawn()
    {
        Ok(child) => {
            log_line(&format!("sing-box spawned pid={}", child.id()));
            std::mem::forget(child); // 不 wait,让它成为孤儿进程继续跑
            0
        }
        Err(e) => {
            log_line(&format!("sing-box spawn failed: {}", e));
            1
        }
    }
}

fn helper_stop() -> i32 {
    // 先恢复 DNS 再杀进程。若先杀 sing-box,TUN 立即 down,物理网卡 DNS 还指向
    // 已不可达的 172.19.0.1,会有数百毫秒的 DNS 查询超时窗口。
    let (ok, err) = reset_all_interfaces_dns();
    log_line(&format!("stop: dns reset ok={} err={}", ok, err));

    match std::process::Command::new("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .status()
    {
        Ok(s) => log_line(&format!("taskkill sing-box.exe: {}", s)),
        Err(e) => log_line(&format!("taskkill failed: {}", e)),
    }
    0
}

// ================= 诊断日志 =================

/// 写一行到 `%TEMP%\onebox-dns.log`。elevated 子进程没有 stdout 可见,
/// 落地文件是唯一的反馈渠道。失败静默忽略。
pub fn log_line(msg: &str) {
    use std::io::Write;
    if let Ok(path) = std::env::temp_dir()
        .join("onebox-dns.log")
        .into_os_string()
        .into_string()
    {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(f, "[{}] {}", chrono_like_stamp(), msg);
        }
    }
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "?".into())
}

// ================= 单元测试 =================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_guid_accepts_braced_and_unbraced() {
        let g = "550e8400-e29b-41d4-a716-446655440000";
        let out = normalize_guid(g).expect("should parse");
        assert_eq!(out, "{550E8400-E29B-41D4-A716-446655440000}");
        let out2 = normalize_guid(&format!("{{{}}}", g)).expect("braced also");
        assert_eq!(out, out2);
    }

    #[test]
    fn normalize_guid_rejects_garbage() {
        assert!(normalize_guid("").is_none());
        assert!(normalize_guid("not-a-guid").is_none());
        assert!(normalize_guid("550e8400-e29b-41d4-a716-44665544000Z").is_none());
        assert!(normalize_guid("550e8400e29b41d4a716446655440000").is_none());
    }

    #[test]
    fn interface_path_has_expected_shape() {
        let p = interface_reg_path("{ABC}");
        assert!(p.ends_with(r"Interfaces\{ABC}"));
        assert!(p.starts_with("SYSTEM"));
    }

    #[test]
    fn tun_alias_detection() {
        assert!(is_tun_alias("sing-box"));
        assert!(is_tun_alias("sing-box tun"));
        assert!(is_tun_alias("WinTUN Userspace Tunnel"));
        assert!(is_tun_alias("OneBox TUN"));
        assert!(!is_tun_alias("Wi-Fi"));
        assert!(!is_tun_alias("Ethernet"));
        assert!(!is_tun_alias("以太网"));
    }

    #[test]
    fn format_nameserver_trims_and_joins() {
        assert_eq!(
            format_nameserver_value(&["172.19.0.1", " 1.1.1.1 "]),
            "172.19.0.1,1.1.1.1"
        );
        assert_eq!(format_nameserver_value(&["", "  ", "8.8.8.8"]), "8.8.8.8");
        assert_eq!(format_nameserver_value(&[]), "");
    }

    #[test]
    fn has_nonzero_ip_detects_real_addresses() {
        assert!(!has_nonzero_ip(""));
        assert!(!has_nonzero_ip("0.0.0.0"));
        assert!(!has_nonzero_ip("0.0.0.0\0"));
        assert!(has_nonzero_ip("192.168.1.2"));
        assert!(has_nonzero_ip("0.0.0.0\u{0}192.168.1.2"));
    }

    #[test]
    fn quote_arg_leaves_simple_args_alone() {
        assert_eq!(quote_arg("foo"), "foo");
        assert_eq!(quote_arg("--flag"), "--flag");
    }

    #[test]
    fn quote_arg_wraps_spaces() {
        assert_eq!(quote_arg("hello world"), "\"hello world\"");
    }

    #[test]
    fn quote_arg_escapes_backslashes_before_quote() {
        assert_eq!(
            quote_arg(r"C:\Program Files\foo\"),
            "\"C:\\Program Files\\foo\\\\\""
        );
    }

    #[test]
    fn quote_arg_escapes_embedded_quote() {
        assert_eq!(quote_arg(r#"a"b"#), r#""a\"b""#);
    }

    #[test]
    fn join_args_assembles_helper_cmdline() {
        let s = join_args(&[
            "--onebox-tun-helper",
            "start",
            r"C:\Program Files\OneBox\sing-box.exe",
            r"C:\Users\me\cfg.json",
            "172.19.0.1",
        ]);
        assert!(s.starts_with("--onebox-tun-helper start \""));
        assert!(s.contains(r"Program Files"));
        assert!(s.ends_with(" 172.19.0.1"));
    }

    /// 集成测试:枚举真机网卡。无副作用,只读注册表,可安全常跑。
    #[test]
    fn enumerate_interfaces_returns_something() {
        let list = enumerate_interfaces().expect("enumerate");
        assert!(!list.is_empty(), "expected at least one interface");
        assert!(
            list.iter().any(|i| !i.alias.is_empty()),
            "expected at least one named interface"
        );
    }
}
