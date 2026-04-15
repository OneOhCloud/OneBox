use crate::vpn::EVENT_TAURI_LOG;
use anyhow;
use onebox_sysproxy_rs::Sysproxy;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::process::Command as TauriCommand;

use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use windows::core::PCWSTR;
use windows::Win32::UI::Shell::ShellExecuteW;

use crate::vpn::helper::extract_tun_gateway_from_config;
use crate::vpn::VpnProxy;
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

/// 设置系统代理（直接调用 onebox-sysproxy-rs 库，无需外部二进制）
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

/// 取消系统代理（直接调用 onebox-sysproxy-rs 库，无需外部二进制）
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
// ZH: Windows DNS Client (Dnscache) 默认启用 SMHNR — 并行往所有活跃网卡
//     发 DNS 查询，用最先返回的应答。结果在审查环境下几乎必中 GFW 的投毒
//     包（污染比正常 DNS 应答更快）。解决办法：把物理网卡的 DNS 服务器改
//     成 TUN 子网里的网关 IP（例如 172.19.0.1）。因为该 IP 只能通过 TUN
//     适配器访问，所有 SMHNR 并发查询都会进 TUN → sing-box `hijack-dns`。
//
//     关键限制：`Set-DnsClientServerAddress` 走 CIM，非管理员调用会被拒。
//     因此 DNS 设置 **必须** 在 elevated 上下文里跑。我们的做法是把
//     "设 DNS + 启 sing-box" 合并到一个 PowerShell 脚本，通过单次
//     `ShellExecuteW runas` 提权执行 — 用户只看到一次 UAC，DNS cmdlet
//     和 sing-box 都继承 elevated 令牌。
//
//     恢复走 Windows 原生的 `-ResetServerAddresses`（把适配器的 DNS 设
//     回 DHCP 下发的默认值），不做快照、不落地文件。elevated 脚本里
//     枚举 `Get-NetAdapter` 对每个适配器执行，幂等。
// EN: Set-DnsClientServerAddress requires admin (CIM access check). Batch
//     "set DNS + exec sing-box" into a single UAC-elevated PS script.
//     Restore uses Windows' native `-ResetServerAddresses` (revert to
//     DHCP-provided DNS); no snapshot, no backup file — the stop script
//     loops over `Get-NetAdapter` and calls reset on each, idempotently.

/// ZH: 把 UTF-8 字符串编码为 ShellExecuteW 需要的以 NUL 结尾的 UTF-16 数组。
fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// ZH: 把 PowerShell 单引号字符串里的 `'` 翻倍转义。
fn ps_quote(s: &str) -> String {
    s.replace('\'', "''")
}

/// ZH: 临时脚本文件路径（放在 %TEMP%）。
fn script_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(name)
}

/// ZH: 用 ShellExecuteW + `runas` verb 启动 PowerShell 执行脚本文件，弹一次 UAC。
///     脚本通过 `-File` 传入，避免命令行拼接转义地狱。
fn run_elevated_powershell_file(script_path: &str) -> Result<(), String> {
    let app_name = to_wide("powershell");
    let params = format!(
        "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
        script_path
    );
    let params_w = to_wide(&params);
    let verb = to_wide("runas");
    let res = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(app_name.as_ptr()),
            PCWSTR(params_w.as_ptr()),
            PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(0),
        )
    };
    if res.0 as usize <= 32 {
        return Err(format!("ShellExecuteW failed: code {}", res.0 as usize));
    }
    Ok(())
}

/// ZH: 用 PowerShell 找默认路由出接口的 InterfaceAlias（"Wi-Fi" / "Ethernet" 等），
///     跳过 OneBox 自己创建的 TUN 适配器。`Get-NetRoute` 是只读 cmdlet，无需管理员。
fn detect_active_interface_alias() -> Result<String, String> {
    let ps = r#"
$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
     Where-Object { $_.InterfaceAlias -notmatch 'sing-box|WinTUN|utun' } |
     Sort-Object RouteMetric | Select-Object -First 1
if ($r) { $r.InterfaceAlias } else { '' }
"#;
    let out = StdCommand::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps])
        .output()
        .map_err(|e| format!("powershell Get-NetRoute failed: {}", e))?;
    let alias = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if alias.is_empty() {
        Err("no active interface alias detected".into())
    } else {
        Ok(alias)
    }
}

/// ZH: 非提权准备阶段 — 提取 TUN 网关、检测出接口。返回 (alias, gateway)。
///     两步都不需要管理员：`extract_tun_gateway_from_config` 是纯文件读，
///     `detect_active_interface_alias` 是只读 CIM query。
fn prepare_dns_override(config_path: &str) -> Result<(String, String), String> {
    let gateway = extract_tun_gateway_from_config(config_path)
        .ok_or_else(|| format!("could not extract TUN gateway from {}", config_path))?;
    let alias = detect_active_interface_alias()?;
    Ok((alias, gateway))
}

/// ZH: 构造一段 PowerShell 代码，用于把物理网卡 DNS 设置成 TUN 网关。
///     失败用 try/catch 吞掉（写到诊断日志），保证脚本后续的 sing-box 一定能起。
fn build_dns_apply_block(alias: &str, gateway: &str) -> String {
    if alias.is_empty() || gateway.is_empty() {
        return String::from("Write-Output '[dns] override skipped (empty alias/gateway)'");
    }
    format!(
        "try {{ Set-DnsClientServerAddress -InterfaceAlias '{}' -ServerAddresses '{}' -ErrorAction Stop; Clear-DnsClientCache; Write-Output '[dns] override OK' }} catch {{ Write-Output ('[dns] override FAILED: ' + $_.Exception.Message) }}",
        ps_quote(alias),
        ps_quote(gateway),
    )
}

/// ZH: 构造一段 PowerShell 代码，枚举所有适配器逐个 `-ResetServerAddresses`，
///     把 DNS 回退到 DHCP 默认。不读备份、不维护状态 —— Windows 原生语义即恢复。
/// EN: PowerShell block that enumerates every adapter and calls
///     `Set-DnsClientServerAddress -ResetServerAddresses` on each — Windows'
///     native "revert to DHCP" semantics, idempotent, no backup file needed.
fn build_dns_restore_block() -> String {
    // Single-quoted PS string with doubled quotes for ' escapes is overkill
    // here — the script body has no interpolated content, keep it literal.
    String::from(
        "Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { \
            try { \
                Set-DnsClientServerAddress -InterfaceAlias $_.Name -ResetServerAddresses -ErrorAction Stop; \
                Write-Output ('[dns] reset ' + $_.Name) \
            } catch { \
                Write-Output ('[dns] reset ' + $_.Name + ' FAILED: ' + $_.Exception.Message) \
            } \
        }; \
        Clear-DnsClientCache",
    )
}

/// ZH: 把 PS 脚本写到 `%TEMP%\<name>`，同时在脚本末尾追加一行 transcript
///     到 `%TEMP%\onebox-dns.log`，方便验证阶段排错（elevated PS 窗口不可见，
///     stdout 会丢失）。
fn write_ps_script(name: &str, body: &str) -> Result<PathBuf, String> {
    let script = format!(
        "$ErrorActionPreference = 'Continue'\n\
         $log = Join-Path $env:TEMP 'onebox-dns.log'\n\
         Start-Transcript -Path $log -Append -Force | Out-Null\n\
         {body}\n\
         Stop-Transcript | Out-Null\n",
        body = body
    );
    let path = script_path(name);
    fs::write(&path, script).map_err(|e| format!("write {}: {}", name, e))?;
    Ok(path)
}

/// 特权模式下启动进程（使用 Windows ShellExecuteW UAC 提权）
/// 单次 UAC 提权同时完成：设置 DNS → 启动 sing-box。
#[cfg(target_os = "windows")]
pub fn create_privileged_command(
    _app: &AppHandle,
    sidecar_path: String,
    path: String,
    _password: String,
) -> Option<TauriCommand> {
    let (alias, gateway) = match prepare_dns_override(&path) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[dns] prepare_dns_override failed: {}", e);
            (String::new(), String::new())
        }
    };

    let dns_block = build_dns_apply_block(&alias, &gateway);
    let body = format!(
        "{dns}\n\
         Write-Output '[tun] starting sing-box'\n\
         & '{sidecar}' run -c '{cfg}' --disable-color\n",
        dns = dns_block,
        sidecar = ps_quote(&sidecar_path),
        cfg = ps_quote(&path),
    );

    let script = match write_ps_script("onebox-tun-start.ps1", &body) {
        Ok(p) => p,
        Err(e) => {
            log::error!("[dns] {}", e);
            return None;
        }
    };
    let script_str = script.to_string_lossy().into_owned();

    if let Err(e) = run_elevated_powershell_file(&script_str) {
        log::error!("Failed to launch elevated TUN start script: {}", e);
        return None;
    }

    log::info!(
        "[dns] elevated PS script dispatched — alias=[{}] gateway={}",
        if alias.is_empty() {
            "<skipped>"
        } else {
            alias.as_str()
        },
        if gateway.is_empty() {
            "<skipped>"
        } else {
            gateway.as_str()
        }
    );
    log::info!(
        "Enable tun mode via elevated PS: {} run -c {}",
        sidecar_path,
        path
    );
    None
}

/// 停止TUN模式下的进程（使用 Windows ShellExecuteW UAC 提权）
/// 单次 UAC 提权同时完成：重置所有适配器 DNS → taskkill sing-box。
#[cfg(target_os = "windows")]
pub fn stop_tun_process(_password: &str) -> Result<(), String> {
    let dns_block = build_dns_restore_block();
    let body = format!(
        "{dns}\n\
         Write-Output '[tun] killing sing-box'\n\
         taskkill /F /IM sing-box.exe 2>&1 | Out-Null\n",
        dns = dns_block
    );

    let script = write_ps_script("onebox-tun-stop.ps1", &body)?;
    let script_str = script.to_string_lossy().into_owned();
    run_elevated_powershell_file(&script_str)?;

    log::info!("Stop tun mode via elevated PS (DNS reset + taskkill)");
    Ok(())
}

/// 崩溃兜底：sing-box 被杀/崩溃，`stop_tun_process` 没跑过，DNS 可能还停在
/// TUN 网关。core.rs 的 `handle_process_termination` 在 TUN 模式退出时无条件
/// 调用这里 —— restore 现在是幂等的枚举 reset，对未被 override 的适配器也
/// 是 no-op。会再弹一次 UAC，无法避免。
#[cfg(target_os = "windows")]
pub fn restore_system_dns() -> Result<(), String> {
    let dns_block = build_dns_restore_block();
    let script = write_ps_script("onebox-dns-restore.ps1", &dns_block)?;
    let script_str = script.to_string_lossy().into_owned();

    log::warn!("[dns] crash-path DNS restore — requesting UAC elevation");
    run_elevated_powershell_file(&script_str)?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn restart_privileged_command(sidecar_path: String, path: String) -> Result<(), String> {
    // 使用 PowerShell 脚本，路径处理更可靠
    let ps_script = format!(
        "Stop-Process -Name 'sing-box' -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; & '{}' run -c '{}' --disable-color",
        sidecar_path.replace("\\", "/"), // PowerShell 接受正斜杠
        path.replace("\\", "/")
    );

    let powershell = OsStr::new("powershell")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();

    let args = format!("-Command \"{}\"", ps_script);
    let args_wide: Vec<u16> = OsStr::new(&args).encode_wide().chain(Some(0)).collect();

    let verb = OsStr::new("runas")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();

    let res = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(powershell.as_ptr()),
            PCWSTR(args_wide.as_ptr()),
            PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD(0),
        )
    };

    if res.0 as usize <= 32 {
        return Err(format!("ShellExecuteW failed: code {}", res.0 as usize));
    }

    log::info!("Restart tun mode with PowerShell command: {}", ps_script);
    Ok(())
}

/// Windows平台的VPN代理实现
pub struct WindowsVpnProxy;

impl VpnProxy for WindowsVpnProxy {
    async fn set_proxy(app: &AppHandle) -> anyhow::Result<()> {
        set_proxy(app).await
    }

    async fn unset_proxy(app: &AppHandle) -> anyhow::Result<()> {
        // 在某些 Windows 使用 sysproxy 取消代理时可能失败，捕获错误并记录日志
        // 但不阻止程序继续运行，因为代理根本不可能设置成功
        // 此处捕获错误是让用户需要以 tun 模式运行时，仍然可以继续
        //
        // On some Windows systems, unsetting the proxy using sysproxy may fail.
        // Capture the error and log it, but do not prevent the program from continuing to run
        // because the proxy may not have been set successfully in the first place.
        // Capturing the error here allows users who need to run in tun mode to continue.
        if let Err(e) = unset_proxy(app).await {
            log::warn!("Failed to unset proxy: {}", e);
            let _ = app.emit(
                EVENT_TAURI_LOG,
                (2, format!("Failed to unset proxy: {}", e)),
            );
        }
        Ok(())
    }

    fn create_privileged_command(
        app: &AppHandle,
        sidecar_path: String,
        path: String,
        password: String,
    ) -> Option<TauriCommand> {
        create_privileged_command(app, sidecar_path, path, password)
    }

    fn stop_tun_process(password: &str) -> Result<(), String> {
        stop_tun_process(password)
    }

    fn restart(sidecar_path: String, path: String) {
        let _ = restart_privileged_command(sidecar_path, path);
    }
}
