use std::fs;
use std::path::Path;

use tauri::utils::platform;

/// 获取 sidecar 路径
pub fn get_sidecar_path(program: &Path) -> Result<String, anyhow::Error> {
    match platform::current_exe()?.parent() {
        #[cfg(windows)]
        Some(exe_dir) => Ok(exe_dir
            .join(program)
            .with_extension("exe")
            .to_string_lossy()
            .into_owned()),
        #[cfg(not(windows))]
        Some(exe_dir) => Ok(exe_dir.join(program).to_string_lossy().into_owned()),
        None => Err(anyhow::anyhow!("Failed to get the executable directory")),
    }
}

/// ZH: 从 sing-box 配置文件里解析出 TUN inbound 的首个 IPv4 网关地址。
///     例如 `"172.19.0.1/30"` → `"172.19.0.1"`。找不到返回 None。
///     用于把系统 DNS 指向该地址，强制 OS 的 DNS 查询必走 TUN 被 hijack-dns 捕获。
/// EN: Parse the rendered sing-box config and return the first IPv4 gateway
///     of the `type == "tun"` inbound. Used as the target of the system-DNS
///     override so OS queries traverse TUN and hit sing-box `hijack-dns`.
pub fn extract_tun_gateway_from_config(config_path: &str) -> Option<String> {
    let content = fs::read_to_string(config_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let inbounds = v.get("inbounds")?.as_array()?;
    for inb in inbounds {
        if inb.get("type").and_then(serde_json::Value::as_str) != Some("tun") {
            continue;
        }
        let addrs = inb.get("address")?.as_array()?;
        for a in addrs {
            let s = a.as_str()?;
            // Entries look like "172.19.0.1/30" or "fdfe:dcba:9876::1/126".
            let ip = s.split('/').next()?;
            if ip.contains('.') && !ip.is_empty() {
                return Some(ip.to_string());
            }
        }
    }
    None
}

