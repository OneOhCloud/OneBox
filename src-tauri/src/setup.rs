use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_http::reqwest;
use url::Url;

use crate::utils::show_dashboard;

/// App 初始化逻辑，对应 Builder::setup 闭包
pub fn app_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    {
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().build())?;
    }

    app.manage(crate::state::AppData::new());

    // 复制 resources 目录下的 .db 文件到 appConfigDir
    if let Err(e) = crate::utils::copy_database_files(app.handle()) {
        log::error!("Failed to copy database files: {}", e);
    }

    report_captive(app);

    // macOS：以无 Dock 图标的附件模式运行，启动时直接显示主窗口
    // 此模式下，访达点击已运行 App 图标时触发 Reopen 事件，需要监听此事件将隐藏的主窗口重新显示
    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        if let Some(w) = app.get_webview_window("main") {
            w.show().unwrap();
            w.set_focus().unwrap();
        }
    }
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        app.deep_link().register_all()?;
    }

    register_deep_link(app);

    // Cold-start on Windows/Linux: handle_cli_arguments() ran during plugin init,
    // before on_open_url was registered, so the event was missed.
    // Directly write to pending_deep_link now so the frontend can retrieve it
    // synchronously via get_pending_deep_link once the webview is ready.
    #[cfg(any(windows, target_os = "linux"))]
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        if let Some(data) = urls.first().and_then(extract_deep_link_data) {
            log::info!("Cold-start deep link config data: {}", data);
            store_pending_deep_link(&app.state::<crate::state::AppData>(), &data);
        }
    }

    Ok(())
}

// ── Deep Link ──────────────────────────────────────────────────────

/// 从 `oneoh-networktools://config?data=...` 中提取 data 参数值
fn extract_deep_link_data(url: &Url) -> Option<String> {
    if url.scheme() != "oneoh-networktools" || url.host_str() != Some("config") {
        return None;
    }
    url.query_pairs()
        .find(|(k, _)| k == "data")
        .map(|(_, v)| v.into_owned())
}

/// 将 deep link data 写入 pending state
fn store_pending_deep_link(app_data: &crate::state::AppData, data: &str) {
    if let Ok(mut pending) = app_data.pending_deep_link.lock() {
        *pending = Some(data.to_string());
    }
}

/// 注册 deep link 回调
fn register_deep_link(app: &tauri::App) {
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        let urls = event.urls();
        log::info!("Received deep link: {:#?}", urls);
        show_dashboard(handle.clone());

        if let Some(data) = urls.first().and_then(extract_deep_link_data) {
            log::info!("Received config data: {}", data);
            // 写入 state（冷/热启动都靠前端主动拉取，保证可靠）
            store_pending_deep_link(&handle.state::<crate::state::AppData>(), &data);
            // 发送无 payload 的信号：前端收到后主动 invoke get_pending_deep_link。
            // 若 WebView 尚未就绪（窗口从隐藏恢复时），信号可能丢失，
            // 但前端同时监听 tauri://focus 作为兜底，数据不会丢。
            handle.emit("deep_link_pending", ()).unwrap_or_else(|e| {
                log::error!("Failed to emit deep_link_pending signal: {}", e);
            });
        }
    });
}

// ── Captive ────────────────────────────────────────────────────────

/// 上报 User-Agent 至存活检测端点
fn report_captive(app: &tauri::App) {
    let app_version = app.package_info().version.to_string();
    let os = tauri_plugin_os::platform();
    let arch = tauri_plugin_os::arch();
    let locale = tauri_plugin_os::locale().unwrap_or_else(|| String::from("en-US"));
    let user_agent = format!(
        "OneBox/{} (Tauri; {}/{}; {})",
        app_version, os, arch, locale
    );

    tauri::async_runtime::spawn(async move {
        log::info!("User-Agent: {}", user_agent);
        let client = reqwest::Client::new();
        match client
            .get("https://captive.oneoh.cloud")
            .header("User-Agent", user_agent)
            .send()
            .await
        {
            Ok(resp) => log::info!("captive.oneoh.cloud status: {}", resp.status()),
            Err(e) => log::error!("captive.oneoh.cloud request error: {}", e),
        }
    });
}

// ── Lifecycle ──────────────────────────────────────────────────────

/// 生命周期事件监听：仅 Windows / macOS 支持。
///
/// **macOS**：必须在 `RunEvent::Ready` 时调用，确保 delegate 安装在 Tauri/WRY 之后，
/// 不会被覆盖。
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn spawn_lifecycle_listener(app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let handle = app_handle.clone();
    // suppress unused warning on Windows
    #[cfg(not(target_os = "macos"))]
    let _ = app_handle;

    let rx = onebox_lifecycle::Sentinel::start().into_receiver();

    std::thread::Builder::new()
        .name("lifecycle-events".into())
        .spawn(move || {
            // 记录系统进入睡眠的墙钟时间（仅 macOS 使用）
            // 注意：必须用 SystemTime 而非 Instant，因为 macOS 单调时钟在休眠期间不计时
            #[cfg(target_os = "macos")]
            let mut sleep_started: Option<std::time::SystemTime> = None;
            // 睡眠超过此时长后触发 VPN 重启（默认 1 小时）
            #[cfg(target_os = "macos")]
            const SLEEP_RESTART_THRESHOLD: std::time::Duration =
                std::time::Duration::from_secs(3600);

            while let Some(event) = rx.recv() {
                use onebox_lifecycle::SystemEvent;
                match event {
                    SystemEvent::ShuttingDown(shutdown_handle) => {
                        handle_shutting_down(shutdown_handle);
                    }
                    SystemEvent::WillPowerOff => {
                        handle_will_power_off();
                    }
                    SystemEvent::WillSleep => {
                        log::info!("System will sleep");
                        #[cfg(target_os = "macos")]
                        {
                            sleep_started = Some(std::time::SystemTime::now());
                        }
                    }
                    SystemEvent::DidWake => {
                        log::info!("System did wake");
                        #[cfg(target_os = "macos")]
                        handle_did_wake(&handle, sleep_started.take(), SLEEP_RESTART_THRESHOLD);
                    }
                    _ => {}
                }
            }
        })
        .expect("failed to spawn lifecycle thread");
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_shutting_down(shutdown_handle: onebox_lifecycle::ShutdownHandle) {
    use crate::vpn::unset_proxy_on_shutdown;
    log::info!("[lifecycle] received ShuttingDown event");
    unset_proxy_on_shutdown();
    shutdown_handle.allow();
    log::info!("[lifecycle] shutdown allowed");
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_will_power_off() {
    use crate::vpn::unset_proxy_on_shutdown;
    log::info!("[lifecycle] received WillPowerOff event");
    unset_proxy_on_shutdown();
    log::info!("System proxy unset on power off");
}

/// 计算实际睡眠时长，超过阈值且 VPN 正在运行时才重启
#[cfg(target_os = "macos")]
fn handle_did_wake(
    handle: &tauri::AppHandle,
    sleep_started: Option<std::time::SystemTime>,
    threshold: std::time::Duration,
) {
    let Some(started) = sleep_started else {
        return;
    };
    let elapsed = started.elapsed().unwrap_or_default();
    let total_secs = elapsed.as_secs();
    log::info!(
        "System was asleep for {}h {}m {}s (threshold: {}h)",
        total_secs / 3600,
        (total_secs % 3600) / 60,
        total_secs % 60,
        threshold.as_secs() / 3600,
    );
    if elapsed < threshold {
        return;
    }
    let Some((mode, path)) = crate::core::get_running_config() else {
        return;
    };
    log::info!(
        "Sleep exceeded threshold ({:?}), restarting VPN (mode: {:?})",
        threshold,
        mode
    );
    let h = handle.clone();
    tauri::async_runtime::block_on(async {
        if let Err(e) = crate::core::stop(h.clone()).await {
            log::error!("Failed to stop VPN for sleep restart: {}", e);
        } else if let Err(e) = crate::core::start(h, path, mode).await {
            log::error!("Failed to restart VPN after sleep: {}", e);
        } else {
            log::info!("VPN restarted after long sleep");
        }
    });
}
