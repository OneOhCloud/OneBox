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
    app.manage(crate::engine::state_machine::EngineStateCell::new());

    // Purge must run before copy_database_files so the resource-bundled v2 defaults
    // are not clobbered by a later v1 cleanup pass.
    crate::utils::purge_legacy_cache_files(app.handle());
    if let Err(e) = crate::utils::copy_database_files(app.handle()) {
        log::error!("Failed to copy database files: {}", e);
    }

    report_captive(app);

    crate::lan::spawn_whitelist_refresh_task(app.handle().clone());

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
    // On Linux release builds the deb/rpm .desktop file already declares
    // MimeType with `Exec=… %u`, so register_all() would create a duplicate
    // handler desktop file causing the OS to prompt the user to choose.
    // Only call register_all() in debug builds (no deb install) and on
    // Windows debug builds.
    #[cfg(all(debug_assertions, any(target_os = "linux", windows)))]
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
        if let Some(payload) = urls.first().and_then(extract_deep_link_data) {
            log::info!("Cold-start deep link config data: {} apply={}", payload.data, payload.apply);
            store_pending_deep_link(&app.state::<crate::state::AppData>(), payload);
        }
    }

    Ok(())
}

// ── Deep Link ──────────────────────────────────────────────────────

/// 从 `oneoh-networktools://config?data=...&apply=1` 中提取参数
fn extract_deep_link_data(url: &Url) -> Option<crate::state::DeepLinkPayload> {
    if url.scheme() != "oneoh-networktools" || url.host_str() != Some("config") {
        return None;
    }
    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let data = params.get("data")?.to_string();
    let apply = params
        .get("apply")
        .map(|v| v == "1")
        .unwrap_or(false);
    Some(crate::state::DeepLinkPayload { data, apply })
}

/// 将 deep link payload 写入 pending state
fn store_pending_deep_link(app_data: &crate::state::AppData, payload: crate::state::DeepLinkPayload) {
    if let Ok(mut pending) = app_data.pending_deep_link.lock() {
        *pending = Some(payload);
    }
}

/// 注册 deep link 回调
fn register_deep_link(app: &tauri::App) {
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        let urls = event.urls();
        log::info!("Received deep link: {:#?}", urls);
        show_dashboard(handle.clone());

        if let Some(payload) = urls.first().and_then(extract_deep_link_data) {
            log::info!("Received config data: {} apply={}", payload.data, payload.apply);
            // 写入 state（冷/热启动都靠前端主动拉取，保证可靠）
            store_pending_deep_link(&handle.state::<crate::state::AppData>(), payload);
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
    let handle = app_handle.clone();

    let rx = onebox_lifecycle::Sentinel::start().into_receiver();

    std::thread::Builder::new()
        .name("lifecycle-events".into())
        .spawn(move || {
            // 网络恢复重启：防抖 + 最小断网时长双重过滤
            //
            // epoch：每次 NetworkDown 自增，用于取消正在等待的重启任务（无锁取消）。
            // network_down_at：记录断网墙钟时间，过滤短暂抖动（< MIN_OUTAGE）。
            //
            // 策略：
            //   NetworkDown → epoch++，记录断网时间，取消已排队的重启
            //   NetworkUp   → 若断网时长 < MIN_OUTAGE 则跳过（短暂抖动）
            //                 否则等待 DEBOUNCE_SECS 秒确认网络稳定，期间若再次断网
            //                 则 epoch 已变，任务自动放弃，不会触发重启
            //
            // Windows 7 / 8 / 8.1：NotifyNetworkConnectivityHintChange 不可用，
            // lifecycle 库不会产生任何 NetworkUp / NetworkDown 事件，
            // 以下逻辑永远不会被触发，行为与未启用 network feature 时完全相同。
            let network_restart_epoch =
                std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let mut network_down_at: Option<std::time::SystemTime> = None;
            // 断网时长低于此值视为短暂抖动，不触发重启
            const MIN_OUTAGE: std::time::Duration = std::time::Duration::from_secs(2);
            // NetworkUp 后等待此时长确认网络稳定，再执行重启
            const DEBOUNCE_SECS: u64 = 3;

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
                    }
                    SystemEvent::DidWake => {
                        log::info!("System did wake");
                    }
                    SystemEvent::NetworkDown => {
                        log::info!("[network] NetworkDown — cancelling any pending engine restart");
                        network_restart_epoch.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        network_down_at = Some(std::time::SystemTime::now());
                    }
                    SystemEvent::NetworkUp => {
                        log::info!("[network] NetworkUp");
                        // 立即重设 TUN DNS —— 幂等操作,无需防抖。Wi-Fi 切换后系统
                        // 会把活动接口 DNS 重置回 DHCP 下发的服务器,哪怕后续的
                        // engine 重启被 MIN_OUTAGE 过滤掉,这一步仍然保证 DNS 继续
                        // 指向 TUN 网关。
                        //
                        // 延迟 1s 再做一次,兜底系统在 NetworkUp 事件之后的"慢一拍"
                        // DNS 写入(DHCP 续租、IPv6 RA、NetworkManager dispatcher 等)。
                        crate::core::reapply_tun_dns_override_if_active();
                        tauri::async_runtime::spawn(async {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            crate::core::reapply_tun_dns_override_if_active();
                        });
                        let down_at = match network_down_at.take() {
                            Some(t) => t,
                            // 初始快照就是 Up（应用刚启动时网络正常），忽略
                            None => continue,
                        };
                        let outage = down_at.elapsed().unwrap_or_default();
                        if outage < MIN_OUTAGE {
                            log::info!(
                                "[network] outage {:.1}s < threshold, skipping restart",
                                outage.as_secs_f32()
                            );
                            continue;
                        }
                        log::info!(
                            "[network] outage {:.1}s — scheduling engine restart in {}s",
                            outage.as_secs_f32(),
                            DEBOUNCE_SECS
                        );
                        let epoch_arc = std::sync::Arc::clone(&network_restart_epoch);
                        let current_epoch =
                            epoch_arc.load(std::sync::atomic::Ordering::Relaxed);
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(DEBOUNCE_SECS))
                                .await;
                            // 若期间又断网，epoch 已自增，放弃本次重启
                            if epoch_arc.load(std::sync::atomic::Ordering::Relaxed)
                                != current_epoch
                            {
                                log::info!("[network] epoch changed, aborting engine restart");
                                return;
                            }
                            let Some((mode, path)) = crate::core::get_running_config() else {
                                return;
                            };
                            log::info!(
                                "[network] network stable, restarting engine (mode: {:?})",
                                mode
                            );
                            if let Err(e) = crate::core::stop(h.clone()).await {
                                log::error!("[network] stop engine failed: {}", e);
                            } else if let Err(e) = crate::core::start(h, path, mode).await {
                                log::error!("[network] restart engine failed: {}", e);
                            } else {
                                log::info!("[network] engine restarted after network recovery");
                            }
                        });
                    }
                    _ => {}
                }
            }
        })
        .expect("failed to spawn lifecycle thread");
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_shutting_down(shutdown_handle: onebox_lifecycle::ShutdownHandle) {
    use crate::engine::cleanup_on_shutdown;
    log::info!("[lifecycle] received ShuttingDown event");
    cleanup_on_shutdown();
    shutdown_handle.allow();
    log::info!("[lifecycle] shutdown allowed");
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn handle_will_power_off() {
    use crate::engine::cleanup_on_shutdown;
    log::info!("[lifecycle] received WillPowerOff event");
    cleanup_on_shutdown();
    log::info!("System proxy unset on power off");
}

