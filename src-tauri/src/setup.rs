use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_http::reqwest;

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

    // 上报 User-Agent 至存活检测端点
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

    let handle = app.handle().clone();
    let deep_link = app.deep_link();
    deep_link.on_open_url(move |event| {
        let urls = event.urls();
        log::info!("Received deep link: {:#?}", urls);
        show_dashboard(handle.clone());

        if let Some(url) = urls.first() {
            if url.scheme() == "oneoh-networktools" && url.host_str() == Some("config") {
                if let Some(query) = url.query() {
                    let params: Vec<(&str, &str)> = query
                        .split('&')
                        .filter_map(|pair| {
                            let mut iter = pair.splitn(2, '=');
                            if let (Some(key), Some(value)) = (iter.next(), iter.next()) {
                                Some((key, value))
                            } else {
                                None
                            }
                        })
                        .collect();
                    for (key, value) in params {
                        if key == "data" {
                            log::info!("Received config data: {}", value);
                            // 写入 state（冷/热启动都靠前端主动拉取，保证可靠）
                            let app_data = handle.state::<crate::state::AppData>();
                            if let Ok(mut pending) = app_data.pending_deep_link.lock() {
                                *pending = Some(value.to_string());
                            }
                            // 发送无 payload 的信号：前端收到后主动 invoke get_pending_deep_link。
                            // 若 WebView 尚未就绪（窗口从隐藏恢复时），信号可能丢失，
                            // 但前端同时监听 tauri://focus 作为兜底，数据不会丢。
                            handle.emit("deep_link_pending", ()).unwrap_or_else(|e| {
                                log::error!("Failed to emit deep_link_pending signal: {}", e);
                            });
                        }
                    }
                }
            }
        }
    });

    // Cold-start on Windows/Linux: handle_cli_arguments() ran during plugin init,
    // before on_open_url was registered, so the event was missed.
    // Directly write to pending_deep_link now so the frontend can retrieve it
    // synchronously via get_pending_deep_link once the webview is ready.
    #[cfg(any(windows, target_os = "linux"))]
    if let Ok(Some(urls)) = deep_link.get_current() {
        if let Some(url) = urls.first() {
            if url.scheme() == "oneoh-networktools" && url.host_str() == Some("config") {
                if let Some(query) = url.query() {
                    for pair in query.split('&') {
                        let mut iter = pair.splitn(2, '=');
                        if let (Some("data"), Some(value)) = (iter.next(), iter.next()) {
                            log::info!("Cold-start deep link config data: {}", value);
                            let app_data = app.state::<crate::state::AppData>();
                            if let Ok(mut pending) = app_data.pending_deep_link.lock() {
                                *pending = Some(value.to_string());
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // 生命周期事件监听：仅 Windows / macOS 支持
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        #[cfg(target_os = "macos")]
        let handle = app.handle().clone();

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
                            // Windows：关机时 DLL 加载器已开始卸载，不能启动新进程，
                            // 直接写注册表清除代理
                            #[cfg(target_os = "windows")]
                            {
                                use crate::vpn::windows::unset_proxy_on_shutdown;
                                if let Err(e) = unset_proxy_on_shutdown() {
                                    log::warn!("Failed to unset proxy on shutdown: {}", e);
                                } else {
                                    log::info!("Handled system shutdown event, VPN proxy unset via registry");
                                }
                            }
                            // macOS：无 DLL 限制，正常走 networksetup 命令行清除代理
                            #[cfg(target_os = "macos")]
                            {
                                use crate::vpn::{PlatformVpnProxy, VpnProxy};
                                let h = handle.clone();
                                tauri::async_runtime::block_on(async {
                                    PlatformVpnProxy::unset_proxy(&h).await.ok();
                                    log::info!("Handled system shutdown event, VPN proxy unset");
                                });
                            }
                            shutdown_handle.allow();
                        }
                        SystemEvent::WillSleep => {
                            log::info!("System will sleep");
                            #[cfg(target_os = "macos")]
                            {
                                // 仅记录睡眠时刻，不中断 VPN，避免短暂休眠的无效操作
                                sleep_started = Some(std::time::SystemTime::now());
                            }
                        }
                        SystemEvent::DidWake => {
                            log::info!("System did wake");
                            #[cfg(target_os = "macos")]
                            {
                                // 计算实际睡眠时长，超过阈值且 VPN 正在运行时才重启
                                if let Some(started) = sleep_started.take() {
                                    let elapsed = started.elapsed().unwrap_or_default();
                                    let total_secs = elapsed.as_secs();
                                    log::info!(
                                        "System was asleep for {}h {}m {}s (threshold: {}h)",
                                        total_secs / 3600,
                                        (total_secs % 3600) / 60,
                                        total_secs % 60,
                                        SLEEP_RESTART_THRESHOLD.as_secs() / 3600,
                                    );
                                    if elapsed >= SLEEP_RESTART_THRESHOLD {
                                        if let Some((mode, path)) =
                                            crate::core::get_running_config()
                                        {
                                            log::info!(
                                                "Sleep exceeded threshold ({:?}), restarting VPN (mode: {:?})",
                                                SLEEP_RESTART_THRESHOLD,
                                                mode
                                            );
                                            let h = handle.clone();
                                            tauri::async_runtime::block_on(async {
                                                if let Err(e) = crate::core::stop(h.clone()).await
                                                {
                                                    log::error!(
                                                        "Failed to stop VPN for sleep restart: {}",
                                                        e
                                                    );
                                                } else if let Err(e) =
                                                    crate::core::start(h, path, mode).await
                                                {
                                                    log::error!(
                                                        "Failed to restart VPN after sleep: {}",
                                                        e
                                                    );
                                                } else {
                                                    log::info!("VPN restarted after long sleep");
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            })
            .expect("failed to spawn lifecycle thread");
    }

    Ok(())
}
