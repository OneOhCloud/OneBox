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
                            // 先写入 state，前端就绪后可主动拉取（冷启动场景）
                            let app_data = handle.state::<crate::state::AppData>();
                            if let Ok(mut pending) = app_data.pending_deep_link.lock() {
                                *pending = Some(value.to_string());
                            }
                            // 同时尝试 emit，热启动（前端已就绪）时直接触发
                            handle.emit("deep_link_config", value).unwrap_or_else(|e| {
                                log::error!("Failed to emit deep_link_config event: {}", e);
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
        use crate::vpn::{PlatformVpnProxy, VpnProxy};

        let handle = app.handle().clone();
        let rx = onebox_lifecycle::Sentinel::start().into_receiver();

        std::thread::Builder::new()
            .name("lifecycle-events".into())
            .spawn(move || {
                while let Some(event) = rx.recv() {
                    use onebox_lifecycle::SystemEvent;
                    match event {
                        SystemEvent::ShuttingDown(shutdown_handle) => {
                            let h = handle.clone();
                            std::thread::spawn(move || {
                                tauri::async_runtime::block_on(async {
                                    PlatformVpnProxy::unset_proxy(&h).await.ok();
                                });
                                shutdown_handle.allow();
                            });
                        }
                        _ => {}
                    }
                }
            })
            .expect("failed to spawn lifecycle thread");
    }

    Ok(())
}
