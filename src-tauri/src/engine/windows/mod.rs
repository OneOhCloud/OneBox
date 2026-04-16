use crate::engine::EVENT_TAURI_LOG;
use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::process::Command as TauriCommand;

use crate::engine::helper::extract_tun_gateway_from_config;
pub mod native;
pub(crate) mod watchdog;
use self::native as windows_native;
use crate::engine::EngineManager;

// 默认绕过列表
pub static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";

/// 代理配置
#[derive(Clone)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    pub bypass: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 6789,
            bypass: DEFAULT_BYPASS.to_string(),
        }
    }
}

/// 设置系统代理(直接调用 onebox-sysproxy-rs 库,无需外部二进制)
pub async fn set_proxy(app: &AppHandle) -> anyhow::Result<()> {
    let config = ProxyConfig::default();
    app.emit(
        EVENT_TAURI_LOG,
        (
            0,
            format!("Start set system proxy: {}:{}", config.host, config.port),
        ),
    )
    .unwrap();

    let sys = Sysproxy {
        enable: true,
        host: config.host.clone(),
        port: config.port,
        bypass: config.bypass,
    };
    sys.set_system_proxy().map_err(|e| anyhow::anyhow!(e))?;
    log::info!("Proxy set to {}:{}", config.host, config.port);
    Ok(())
}

/// 取消系统代理
pub async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()> {
    app.emit(EVENT_TAURI_LOG, (0, "Start unset system proxy"))
        .unwrap();

    let mut sysproxy = match Sysproxy::get_system_proxy() {
        Ok(proxy) => proxy,
        Err(e) => {
            let msg = format!("Sysproxy::get_system_proxy failed: {}", e);
            let _ = app.emit(EVENT_TAURI_LOG, (1, msg.clone()));
            return Err(anyhow::anyhow!(msg));
        }
    };
    sysproxy.enable = false;
    if let Err(e) = sysproxy.set_system_proxy() {
        let msg = format!("Sysproxy::set_system_proxy failed: {}", e);
        let _ = app.emit(EVENT_TAURI_LOG, (1, msg.clone()));
        return Err(anyhow::anyhow!(msg));
    }

    app.emit(EVENT_TAURI_LOG, (0, "System proxy unset successfully"))
        .unwrap();
    log::info!("Proxy unset");
    Ok(())
}

// ========== Windows 系统 DNS 接管 + 单次 UAC 提权启动 ==========
//
// ZH: Windows DNS Client (Dnscache) 默认启用 SMHNR —— 并行往所有活跃网卡发 DNS
//     查询,用最先返回的应答。审查环境下几乎必中 GFW 的投毒包。解决办法:把物理
//     网卡的 DNS 服务器改成 TUN 子网里的网关 IP(例如 172.19.0.1),该 IP 只能
//     通过 TUN 适配器访问,所有 SMHNR 并发查询都会进 TUN → sing-box `hijack-dns`。
//
//     旧实现用临时 PowerShell 脚本 + ShellExecuteW runas,现在重构为"自我提权 +
//     helper 子命令":父进程(非提权)用 `OneBox.exe --onebox-tun-helper <sub> ...`
//     ShellExecuteExW runas 启动一份新 exe,elevated 子进程在 lib.rs::run() 开头
//     被 windows_native::run_helper 捕获,直接走注册表写 DNS / 起 sing-box /
//     taskkill sing-box,跑完 exit,不进入 tauri runtime。
//
//     所有 DNS 操作都走 HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\
//     Interfaces\{GUID}\NameServer 的 REG_SZ 值(见 windows_native 模块)。恢复走
//     "清空 NameServer 让 Windows 回落到 DhcpNameServer",等价于
//     `Set-DnsClientServerAddress -ResetServerAddresses`。
//
//     出接口检测不再做 —— helper 以 scorched-earth 策略对所有非 TUN 且有 IP 的
//     网卡都覆写 DNS,和 restore 路径的枚举策略对称,符合 CLAUDE.md 设计哲学#3。

/// Locate the bundled `tun-service.exe` sitting next to `OneBox.exe`.
/// In `cargo run` dev builds it's placed there automatically by the workspace
/// build. Release bundling via Tauri `externalBin` is still TODO.
#[cfg(target_os = "windows")]
fn bundled_service_exe_path() -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = [
        "tun-service.exe",
        "tun-service-x86_64-pc-windows-msvc.exe",
        "tun-service-aarch64-pc-windows-msvc.exe",
    ];
    candidates
        .into_iter()
        .map(|n| exe_dir.join(n))
        .find(|p| p.exists())
}

/// Start the TUN mode via the Windows service.
///
/// Flow:
///   1. Locate the bundled service binary.
///   2. Non-elevated fast path: `check_freshness()`. If `UpToDate`, skip UAC.
///      Otherwise self-elevate to the `install-service` helper subcommand
///      (synchronous wait on the elevated child process).
///   3. Extract the TUN gateway from the sing-box config.
///   4. Non-elevated `StartServiceW` with `[config, gateway, sidecar]`.
///   5. Return `None` — sing-box runs inside the service process; no child
///      handle in the parent. The readiness prober drives `Starting → Running`
///      via the clash API, and the Windows service watchdog in `core.rs`
///      synthesises `handle_process_termination` on service exit.
#[cfg(target_os = "windows")]
pub fn create_privileged_command(
    _app: &AppHandle,
    sidecar_path: String,
    path: String,
) -> Option<TauriCommand> {
    use tun_service::scm;

    let bundled = match bundled_service_exe_path() {
        Some(p) => p,
        None => {
            log::error!(
                "[service] cannot locate bundled tun-service.exe next to OneBox.exe; \
                 release bundling via externalBin is still TODO"
            );
            return None;
        }
    };

    // Fast path: only pop UAC if the installed service is missing or stale.
    let freshness = scm::check_freshness(&bundled);
    log::info!("[service] freshness = {:?}", freshness);
    if !matches!(freshness, scm::Freshness::UpToDate) {
        let bundled_s = bundled.to_string_lossy().into_owned();
        if let Err(e) =
            windows_native::self_elevate_helper("install-service", &[bundled_s.as_str()])
        {
            log::error!("[service] elevated install-service failed: {}", e);
            return None;
        }
        log::info!("[service] install-service helper completed");
    }

    let gateway = extract_tun_gateway_from_config(&path).unwrap_or_else(|| {
        log::warn!(
            "[dns] could not extract TUN gateway from {}, DNS override will be skipped",
            path
        );
        String::new()
    });
    let gateway_arg: String = if gateway.is_empty() {
        "-".into()
    } else {
        gateway.clone()
    };

    if let Err(e) =
        scm::start_service_with_args(&[path.as_str(), gateway_arg.as_str(), sidecar_path.as_str()])
    {
        log::error!("[service] start_service_with_args failed: {}", e);
        return None;
    }

    log::info!(
        "[service] OneBoxTunService started (config={}, gateway={}, sidecar={})",
        path,
        if gateway.is_empty() {
            "-"
        } else {
            gateway.as_str()
        },
        sidecar_path
    );
    None
}

/// Stop TUN mode: ask the Windows service to stop. The service resets DNS
/// scorched-earth internally before reporting `STOPPED`, so the parent
/// process does not need to re-run the restore.
#[cfg(target_os = "windows")]
pub fn stop_tun_process() -> Result<(), String> {
    tun_service::scm::stop_service().map_err(|e| {
        log::error!("[service] stop_service failed: {}", e);
        e
    })?;
    log::info!("[service] OneBoxTunService stop requested");
    Ok(())
}

/// 崩溃兜底:sing-box 被杀/崩溃、stop_tun_process 没跑过时,DNS 可能还停在 TUN
/// 网关。core::handle_process_termination 在 TUN 模式退出时无条件调用这里。
/// reset_all_interfaces_dns 是幂等的枚举 reset,对未被 override 的适配器是 no-op。
/// 会再弹一次 UAC,无法避免。
#[cfg(target_os = "windows")]
pub fn restore_system_dns() -> Result<(), String> {
    log::warn!("[dns] crash-path DNS restore — requesting UAC elevation");
    windows_native::self_elevate_helper("restore-dns", &[])
}

#[cfg(target_os = "windows")]
pub fn restart_privileged_command(sidecar_path: String, path: String) -> Result<(), String> {
    // restart = stop + start via the Windows service; no UAC prompts because
    // the ACL granted at install time lets Authenticated Users do both.
    stop_tun_process()?;
    std::thread::sleep(std::time::Duration::from_millis(500));

    let gateway = extract_tun_gateway_from_config(&path).unwrap_or_default();
    let gateway_arg: String = if gateway.is_empty() {
        "-".into()
    } else {
        gateway
    };
    tun_service::scm::start_service_with_args(&[
        path.as_str(),
        gateway_arg.as_str(),
        sidecar_path.as_str(),
    ])?;
    log::info!("[service] OneBoxTunService restarted");
    // DNS cache flush happens inside the service (service.rs::service_main)
    // because `ipconfig /flushdns` needs admin on Windows 10+. Calling it
    // from this Rust process would run as the user and silently fail.
    Ok(())
}

/// Windows平台的VPN代理实现
pub struct WindowsEngine;

impl EngineManager for WindowsEngine {
    async fn start(
        app: &AppHandle,
        mode: crate::engine::ProxyMode,
        config_path: String,
    ) -> Result<(), String> {
        use std::sync::Arc;
        use tauri_plugin_shell::ShellExt;

        match mode {
            crate::engine::ProxyMode::SystemProxy => {
                let cmd = app
                    .shell()
                    .sidecar("sing-box")
                    .map_err(|e| format!("sidecar lookup failed: {}", e))?
                    .args(["run", "-c", &config_path, "--disable-color"]);
                let (rx, child) = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
                crate::core::monitor::spawn_process_monitor(
                    app.clone(),
                    rx,
                    Arc::new(mode.clone()),
                );
                {
                    let mut mgr = crate::core::ProcessManager::acquire();
                    mgr.mode = Some(Arc::new(mode));
                    mgr.config_path = Some(Arc::new(config_path));
                    mgr.child = Some(child);
                    mgr.is_stopping = false;
                }
                if let Err(e) = set_proxy(app).await {
                    let _ = app.emit(EVENT_TAURI_LOG, (2, format!("Failed to set proxy: {}", e)));
                    return Err(e.to_string());
                }
            }
            crate::engine::ProxyMode::TunProxy => {
                let sidecar_path = crate::engine::helper::get_sidecar_path(
                    std::path::Path::new("sing-box"),
                )
                .map_err(|e| format!("Failed to get sidecar path: {}", e))?;
                let cmd = create_privileged_command(app, sidecar_path, config_path.clone())
                    .ok_or_else(|| "service command not available".to_string())?;
                let (rx, child) = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
                crate::core::monitor::spawn_process_monitor(
                    app.clone(),
                    rx,
                    Arc::new(mode.clone()),
                );
                let mode_arc = Arc::new(mode);
                {
                    let mut mgr = crate::core::ProcessManager::acquire();
                    mgr.mode = Some(Arc::clone(&mode_arc));
                    mgr.config_path = Some(Arc::new(config_path));
                    mgr.child = Some(child);
                    mgr.is_stopping = false;
                }
                // Poll the SCM service state so external kills / crashes
                // surface through the normal process_monitor path.
                watchdog::spawn(app.clone(), mode_arc);
                // SystemProxy setting may linger across mode switches on
                // Windows; best-effort unset so browsers stop pointing at
                // the mixed port.
                if let Err(e) = unset_proxy(app).await {
                    log::warn!("Failed to unset proxy: {}", e);
                    let _ = app.emit(
                        EVENT_TAURI_LOG,
                        (2, format!("Failed to unset proxy: {}", e)),
                    );
                }
            }
        }
        Ok(())
    }

    async fn stop(app: &AppHandle) -> Result<(), String> {
        let (mode, child) = {
            let mut mgr = crate::core::ProcessManager::acquire();
            mgr.is_stopping = true;
            (mgr.mode.clone(), mgr.child.take())
        };
        let Some(mode) = mode else { return Ok(()); };
        match mode.as_ref() {
            crate::engine::ProxyMode::SystemProxy => {
                if let Err(e) = unset_proxy(app).await {
                    log::warn!("Failed to unset proxy: {}", e);
                    let _ = app.emit(
                        EVENT_TAURI_LOG,
                        (2, format!("Failed to unset proxy: {}", e)),
                    );
                }
                if let Some(child) = child {
                    child.kill().map_err(|e| e.to_string())?;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            crate::engine::ProxyMode::TunProxy => {
                stop_tun_process().map_err(|e| {
                    log::error!("Failed to stop TUN process: {}", e);
                    e
                })?;
            }
        }
        Ok(())
    }

    // Windows has no NetworkUp DNS re-apply — DNS override lives in the
    // service process which reads interface state on start. Default no-op
    // from the trait is fine.

    fn on_process_terminated(_app: &AppHandle, was_user_stop: bool) {
        if was_user_stop {
            log::info!(
                "[dns] user-initiated stop; service already reset DNS, skipping UAC fallback"
            );
        } else {
            log::warn!(
                "[dns] TUN process terminated unexpectedly — requesting UAC DNS restore"
            );
            if let Err(e) = restore_system_dns() {
                log::warn!("[dns] fallback restore_system_dns failed: {}", e);
            }
        }
    }

    async fn ensure_installed(_app: &AppHandle) -> Result<(), String> {
        // Service installation self-elevates; Windows pops UAC the first
        // time. Once installed, the ACL granted at install time lets
        // Authenticated Users start/stop the service without further
        // prompts (see `start`/`stop` above).
        let sidecar = crate::engine::helper::get_sidecar_path(std::path::Path::new("sing-box"))
            .map_err(|e| format!("Failed to resolve bundled exe: {}", e))?;
        tokio::task::spawn_blocking(move || {
            windows_native::self_elevate_helper("install-service", &[sidecar.as_str()])
        })
        .await
        .map_err(|e| format!("install-service join error: {}", e))?
    }

    async fn probe(_app: &AppHandle) -> Result<String, String> {
        use tun_service::scm::QueriedState;
        match tun_service::scm::query_state() {
            QueriedState::Running => Ok("running".into()),
            QueriedState::Stopped => Ok("stopped".into()),
            QueriedState::StartPending => Ok("start-pending".into()),
            QueriedState::StopPending => Ok("stop-pending".into()),
            QueriedState::Other => Ok("other".into()),
            QueriedState::NotInstalled => Err("not installed".into()),
        }
    }

    async fn restart(_app: &AppHandle) -> Result<(), String> {
        // Windows service is driven by SCM; SIGHUP is not a thing. The
        // "reload" is a stop+start of OneBoxTunService, with the service
        // itself running `ipconfig /flushdns` from SYSTEM context during
        // its startup (see tun-service/src/service.rs::service_main).
        let (config_path, sidecar_path) = {
            let manager = crate::core::ProcessManager::acquire();
            let cfg = manager
                .config_path
                .as_ref()
                .map(|p| p.as_str().to_string())
                .unwrap_or_default();
            let sidecar = crate::engine::helper::get_sidecar_path(std::path::Path::new("sing-box"))
                .map_err(|e| format!("Failed to get sidecar path: {}", e))?;
            (cfg, sidecar)
        };
        restart_privileged_command(sidecar_path, config_path)
    }
}
