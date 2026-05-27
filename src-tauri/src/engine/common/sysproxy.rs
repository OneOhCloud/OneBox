//! Cross-platform system HTTP/SOCKS proxy override.
//!
//! All three platforms shell through `onebox_sysproxy_rs` — the only
//! thing that varies is the per-OS bypass-list syntax (comma vs
//! semicolon, glob vs CIDR). Collapsing into one module kills three
//! near-identical copies in the platform mods.
//!
//! Proxy always points at the Mixed inbound's listen port.
//!
//! `set_*` emits a frontend log line (Windows historically did, macOS
//! and Linux did not — we now do it on all three for symmetry); failure
//! returns `anyhow::Error` so callers can fall through their usual
//! state-machine error path.

use tauri::{AppHandle, Emitter};

use crate::{core::mixed_proxy_port, engine::EVENT_TAURI_LOG};

const PROXY_HOST: &str = "127.0.0.1";

/// Bypass-list syntax differs per platform — see the `onebox_sysproxy_rs`
/// source for exactly how it's parsed. The values below were migrated
/// verbatim from the previous per-platform duplicates.
#[cfg(target_os = "macos")]
const DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

#[cfg(target_os = "linux")]
const DEFAULT_BYPASS: &str =
    "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";

#[cfg(target_os = "windows")]
const DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
const DEFAULT_BYPASS: &str = "localhost,127.0.0.1";

/// Apply the HTTP/SOCKS system proxy pointing at the Mixed inbound.
pub(crate) async fn set_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let proxy_port = mixed_proxy_port(app);
    let _ = app.emit(
        EVENT_TAURI_LOG,
        (
            0,
            format!("Start set system proxy: {}:{}", PROXY_HOST, proxy_port),
        ),
    );
    platform_set_system_proxy(proxy_port, DEFAULT_BYPASS)?;
    log::info!("Proxy set to {}:{}", PROXY_HOST, proxy_port);
    Ok(())
}

/// Clear whatever proxy was set. Reads the current setting first so we
/// keep any non-proxy fields (bypass list) intact — only flip `enable`
/// to false, matching the old per-platform behavior.
pub(crate) async fn clear_system_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let _ = app.emit(EVENT_TAURI_LOG, (0, "Start unset system proxy"));
    if let Err(e) = platform_clear_system_proxy() {
        let msg = format!("clear system proxy failed: {}", e);
        let _ = app.emit(EVENT_TAURI_LOG, (1, msg.clone()));
        return Err(anyhow::anyhow!(msg));
    }
    let _ = app.emit(EVENT_TAURI_LOG, (0, "System proxy unset successfully"));
    log::info!("Proxy unset");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn platform_set_system_proxy(port: u16, bypass: &str) -> anyhow::Result<()> {
    let sys = onebox_sysproxy_rs::Sysproxy {
        enable: true,
        host: PROXY_HOST.to_string(),
        port,
        bypass: bypass.to_string(),
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))
}

#[cfg(not(target_os = "macos"))]
fn platform_clear_system_proxy() -> anyhow::Result<()> {
    let mut sysproxy = onebox_sysproxy_rs::Sysproxy::get_system_proxy()
        .map_err(|e| anyhow::anyhow!("Sysproxy::get_system_proxy failed: {}", e))?;
    sysproxy.enable = false;
    sysproxy
        .set_system_proxy()
        .map_err(|e| anyhow::anyhow!("Sysproxy::set_system_proxy failed: {}", e))
}

#[cfg(target_os = "macos")]
mod macos_proxy {
    use anyhow::{anyhow, Context};
    use std::process::Command;

    use super::PROXY_HOST;

    #[derive(Clone, Copy)]
    enum ProxyKind {
        Http,
        Https,
        Socks,
    }

    impl ProxyKind {
        fn target(self) -> &'static str {
            match self {
                ProxyKind::Http => "webproxy",
                ProxyKind::Https => "securewebproxy",
                ProxyKind::Socks => "socksfirewallproxy",
            }
        }
    }

    pub(super) fn set_system_proxy(port: u16, bypass: &str) -> anyhow::Result<()> {
        let service = detect_active_network_service()?;
        log::info!("[sysproxy] active macOS network service: {}", service);

        for kind in [ProxyKind::Http, ProxyKind::Https, ProxyKind::Socks] {
            set_proxy(&service, kind, port, true)?;
        }
        set_bypass(&service, bypass)?;
        verify_proxy(&service, port)?;
        Ok(())
    }

    pub(super) fn clear_system_proxy() -> anyhow::Result<()> {
        // Clear the current active service, then opportunistically clear any
        // other service still pointing at OneBox. This avoids leaving a stale
        // proxy behind if the active interface changed since start.
        let mut services = list_network_services()?;
        if let Ok(active) = detect_active_network_service() {
            services.retain(|s| s != &active);
            services.insert(0, active);
        }

        let mut first_err: Option<anyhow::Error> = None;
        for service in services {
            let should_clear = match service_points_to_onebox(&service) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[sysproxy] inspect [{}] failed: {}", service, e);
                    false
                }
            };
            if !should_clear {
                continue;
            }
            for kind in [ProxyKind::Http, ProxyKind::Https, ProxyKind::Socks] {
                if let Err(e) = set_proxy(&service, kind, 0, false) {
                    log::warn!("[sysproxy] clear [{}] failed: {}", service, e);
                    if first_err.is_none() {
                        first_err = Some(e);
                    }
                }
            }
        }

        if let Some(e) = first_err {
            Err(e)
        } else {
            Ok(())
        }
    }

    fn run_networksetup(args: &[&str]) -> anyhow::Result<String> {
        let out = Command::new("networksetup")
            .args(args)
            .output()
            .with_context(|| format!("networksetup {:?} failed to spawn", args))?;
        if !out.status.success() {
            return Err(anyhow!(
                "networksetup {:?} exited {:?}: {}",
                args,
                out.status.code(),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    fn detect_active_network_service() -> anyhow::Result<String> {
        let route = Command::new("route")
            .args(["-n", "get", "default"])
            .output()
            .context("route -n get default failed to spawn")?;
        if !route.status.success() {
            return Err(anyhow!(
                "route -n get default exited {:?}: {}",
                route.status.code(),
                String::from_utf8_lossy(&route.stderr).trim()
            ));
        }
        let stdout = String::from_utf8_lossy(&route.stdout);
        let iface = stdout
            .lines()
            .find_map(|l| {
                l.trim()
                    .strip_prefix("interface:")
                    .map(|s| s.trim().to_string())
            })
            .ok_or_else(|| anyhow!("route -n get default did not report an interface"))?;

        let ports = run_networksetup(&["-listallhardwareports"])?;
        let mut current_port: Option<String> = None;
        for line in ports.lines().map(str::trim) {
            if let Some(rest) = line.strip_prefix("Hardware Port:") {
                current_port = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("Device:") {
                if rest.trim() == iface {
                    return current_port
                        .take()
                        .ok_or_else(|| anyhow!("device {} has no hardware port", iface));
                }
            }
        }
        Err(anyhow!("could not map interface {} to a network service", iface))
    }

    fn set_proxy(
        service: &str,
        kind: ProxyKind,
        port: u16,
        enable: bool,
    ) -> anyhow::Result<()> {
        if enable {
            let target = format!("-set{}", kind.target());
            let port = port.to_string();
            run_networksetup(&[&target, service, PROXY_HOST, &port])?;
        }

        let target_state = format!("-set{}state", kind.target());
        run_networksetup(&[&target_state, service, if enable { "on" } else { "off" }])?;
        Ok(())
    }

    fn set_bypass(service: &str, bypass: &str) -> anyhow::Result<()> {
        let mut args = vec!["-setproxybypassdomains", service];
        let domains: Vec<&str> = bypass.split(',').filter(|s| !s.is_empty()).collect();
        args.extend(domains);
        run_networksetup(&args)?;
        Ok(())
    }

    fn verify_proxy(service: &str, port: u16) -> anyhow::Result<()> {
        for kind in [ProxyKind::Http, ProxyKind::Https, ProxyKind::Socks] {
            let target = format!("-get{}", kind.target());
            let out = run_networksetup(&[&target, service])?;
            let enabled = parse_field(&out, "Enabled:") == "Yes";
            let server = parse_field(&out, "Server:");
            let actual_port = parse_field(&out, "Port:");
            if !enabled || server != PROXY_HOST || actual_port != port.to_string() {
                return Err(anyhow!(
                    "{} verification failed on [{}]: enabled={} server={} port={}",
                    kind.target(),
                    service,
                    enabled,
                    server,
                    actual_port
                ));
            }
        }
        Ok(())
    }

    fn service_points_to_onebox(service: &str) -> anyhow::Result<bool> {
        for kind in [ProxyKind::Http, ProxyKind::Https, ProxyKind::Socks] {
            let target = format!("-get{}", kind.target());
            let out = run_networksetup(&[&target, service])?;
            if parse_field(&out, "Enabled:") == "Yes" && parse_field(&out, "Server:") == PROXY_HOST
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn list_network_services() -> anyhow::Result<Vec<String>> {
        let out = run_networksetup(&["-listallnetworkservices"])?;
        Ok(out
            .lines()
            .skip(1)
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('*'))
            .map(ToString::to_string)
            .collect())
    }

    fn parse_field<'a>(text: &'a str, key: &str) -> &'a str {
        text.lines()
            .find_map(|line| line.trim().strip_prefix(key).map(str::trim))
            .unwrap_or("")
    }
}

#[cfg(target_os = "macos")]
fn platform_set_system_proxy(port: u16, bypass: &str) -> anyhow::Result<()> {
    macos_proxy::set_system_proxy(port, bypass)
}

#[cfg(target_os = "macos")]
fn platform_clear_system_proxy() -> anyhow::Result<()> {
    macos_proxy::clear_system_proxy()
}
