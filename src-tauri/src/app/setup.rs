use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_http::reqwest;
#[cfg(any(windows, target_os = "linux"))]
use tauri_plugin_store::StoreExt;
use url::Url;

use crate::utils::show_dashboard;

// Key mirrors `UPDATE_SUPPRESS_ARGV_DEEPLINK_AT_KEY` in
// `src/types/definition.ts`. JS writes `{ at: <ms> }` before
// `updateInfo.install()`; Rust reads it once on cold-start to decide
// whether the argv-carried URL is a genuine user click or an NSIS replay
// of the original launch argv.
#[cfg(any(windows, target_os = "linux"))]
const UPDATE_SUPPRESS_KEY: &str = "update_suppress_argv_deeplink_at";

// Max age of the suppression marker. Set to 5 min: NSIS install + relaunch
// finishes in seconds even on slow hardware, so anything older is a stale
// residue from a failed update and must NOT keep suppressing deep links.
// Only consumed by the Windows/Linux cold-start path; silence dead_code on
// macOS where the caller is cfg'd out entirely (still exercised by tests).
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
const UPDATE_SUPPRESS_TTL_MS: u128 = 5 * 60 * 1000;

/// App 初始化逻辑，对应 Builder::setup 闭包
pub fn app_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    {
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().build())?;
    }

    app.manage(crate::app::state::AppData::new());
    app.manage(crate::engine::state_machine::EngineStateCell::new());

    // Purge must run before copy_database_files so the resource-bundled v2 defaults
    // are not clobbered by a later v1 cleanup pass.
    crate::utils::purge_legacy_cache_files(app.handle());

    // One-shot sweep of rotated OneBox.log archives older than 7 days.
    // Paired with tauri-plugin-log's KeepAll rotation in `plugins.rs`.
    crate::core::cleanup_old_onebox_logs(app.handle());
    if let Err(e) = crate::utils::copy_database_files(app.handle()) {
        log::error!("Failed to copy database files: {}", e);
    }

    report_captive(app);

    crate::commands::whitelist::spawn_whitelist_refresh_task(app.handle().clone());

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

    // On Windows release builds the NSIS installer writes HKLM. But any
    // prior `tauri dev` run wrote HKCU pointing at the dev exe, and HKCU
    // wins over HKLM during protocol resolution — so deep links launch a
    // stale/missing dev binary and silently fail. Scrub HKCU so HKLM
    // becomes authoritative; no-op if HKCU was never populated.
    #[cfg(all(not(debug_assertions), windows))]
    clear_stale_hkcu_deep_link();

    register_deep_link(app);

    // Cold-start on Windows/Linux: handle_cli_arguments() ran during plugin init,
    // before on_open_url was registered, so the event was missed.
    // Directly write to pending_deep_link now so the frontend can retrieve it
    // synchronously via get_pending_deep_link once the webview is ready.
    //
    // Exception: tauri-plugin-updater forwards the original argv to the new
    // exe via NSIS `/ARGS`. Without this guard, every post-update cold-start
    // would replay the launch URL and re-import + re-apply. We cooperate with
    // JS: `markPendingUpdateRelaunch` writes a timestamp just before
    // `updateInfo.install()`, and we read + drop it here. Deletion is
    // best-effort; the TTL check is the authoritative guard so a stuck marker
    // can only suppress deep links for at most `UPDATE_SUPPRESS_TTL_MS`
    // before self-healing.
    #[cfg(any(windows, target_os = "linux"))]
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        let argv_url = urls.first().and_then(extract_deep_link_data);
        if let Some(payload) = argv_url {
            if should_suppress_argv_deeplink(app.handle()) {
                log::info!(
                    "Cold-start deep link suppressed (post-update replay): data-len={} apply={}",
                    payload.data.len(),
                    payload.apply
                );
            } else {
                log::info!(
                    "Cold-start deep link config data: {} apply={}",
                    payload.data,
                    payload.apply
                );
                store_pending_deep_link(&app.state::<crate::app::state::AppData>(), payload);
            }
        }
    }

    Ok(())
}

/// Read, check TTL, best-effort delete the suppression marker. Returns
/// `true` when the argv deep link must be discarded (fresh marker found).
///
/// Invariants:
/// - Only `markPendingUpdateRelaunch` (JS) ever WRITES this key.
/// - This function ONLY reads + deletes — never rewrites.
/// - Delete failure is non-fatal: TTL expiry will eventually free the flag.
///
/// Store-load note: `app.get_store()` only returns a handle if the store is
/// already loaded. On post-update cold-start the webview hasn't initialised
/// yet, so no JS code has touched the store in this process — `get_store`
/// would return `None` and the suppression would silently no-op. `app.store()`
/// loads from disk if needed (or returns the existing handle), which is the
/// only API that makes this decision actually visible to Rust on cold-start.
#[cfg(any(windows, target_os = "linux"))]
fn should_suppress_argv_deeplink(app: &tauri::AppHandle) -> bool {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(e) => {
            log::warn!(
                "[update-suppress] failed to load settings.json, not suppressing: {}",
                e
            );
            return false;
        }
    };
    let raw = store.get(UPDATE_SUPPRESS_KEY);
    // Always try to clear — even if we decide NOT to suppress (stale marker),
    // dropping it now prevents a future false positive from the same residue.
    let _ = store.delete(UPDATE_SUPPRESS_KEY);
    let _ = store.save();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let decision = decide_suppress_argv_deeplink(raw.as_ref(), now_ms);
    match &decision {
        SuppressDecision::Missing => {
            log::info!("[update-suppress] no marker present → not suppressing");
        }
        SuppressDecision::Malformed => {
            log::warn!("[update-suppress] marker malformed (no u64 `at`) → not suppressing");
        }
        SuppressDecision::Expired { age_ms } => {
            log::info!(
                "[update-suppress] marker age={}ms ≥ ttl={}ms → not suppressing (stale residue)",
                age_ms,
                UPDATE_SUPPRESS_TTL_MS
            );
        }
        SuppressDecision::Fresh { age_ms } => {
            log::info!(
                "[update-suppress] marker age={}ms < ttl={}ms → suppressing argv deep link",
                age_ms,
                UPDATE_SUPPRESS_TTL_MS
            );
        }
    }
    matches!(decision, SuppressDecision::Fresh { .. })
}

// Only consumed by the Windows/Linux cold-start path; silence dead_code on
// macOS where the caller is cfg'd out entirely (still exercised by tests).
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
enum SuppressDecision {
    Missing,
    Malformed,
    Expired { age_ms: u128 },
    Fresh { age_ms: u128 },
}

/// Pure decision helper extracted so it can be unit-tested without a
/// `tauri::App` runtime. `raw` is the deserialised value at
/// `UPDATE_SUPPRESS_KEY` (or `None` if absent); `now_ms` is the current
/// UNIX-epoch millisecond count.
// Only consumed by the Windows/Linux cold-start path; silence dead_code on
// macOS where the caller is cfg'd out entirely (still exercised by tests).
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
fn decide_suppress_argv_deeplink(
    raw: Option<&serde_json::Value>,
    now_ms: u128,
) -> SuppressDecision {
    let Some(value) = raw else {
        return SuppressDecision::Missing;
    };
    let Some(at_ms) = value.get("at").and_then(|v| v.as_u64()) else {
        return SuppressDecision::Malformed;
    };
    // Saturating subtraction handles wall-clock going backwards (NTP step)
    // and the rare case where the marker timestamp is slightly in the future.
    let age_ms = now_ms.saturating_sub(at_ms as u128);
    if age_ms < UPDATE_SUPPRESS_TTL_MS {
        SuppressDecision::Fresh { age_ms }
    } else {
        SuppressDecision::Expired { age_ms }
    }
}

// ── Deep Link ──────────────────────────────────────────────────────

/// 从 `oneoh-networktools://config?data=...&apply=1` 中提取参数
fn extract_deep_link_data(url: &Url) -> Option<crate::app::state::DeepLinkPayload> {
    if url.scheme() != "oneoh-networktools" || url.host_str() != Some("config") {
        return None;
    }
    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let data = params.get("data")?.to_string();
    let apply = params.get("apply").map(|v| v == "1").unwrap_or(false);
    Some(crate::app::state::DeepLinkPayload { data, apply })
}

/// 将 deep link payload 写入 pending state
fn store_pending_deep_link(
    app_data: &crate::app::state::AppData,
    payload: crate::app::state::DeepLinkPayload,
) {
    if let Ok(mut pending) = app_data.pending_deep_link.lock() {
        *pending = Some(payload);
    }
}

#[cfg(all(not(debug_assertions), windows))]
fn clear_stale_hkcu_deep_link() {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegDeleteTreeW, HKEY_CURRENT_USER};
    let path: Vec<u16> = "Software\\Classes\\oneoh-networktools\0"
        .encode_utf16()
        .collect();
    let rc = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr())) };
    log::info!(
        "[deep-link] HKCU cleanup rc={:?} (NSIS HKLM is authoritative)",
        rc.0
    );
}

/// 注册 deep link 回调
fn register_deep_link(app: &tauri::App) {
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        let urls = event.urls();
        log::info!("Received deep link: {:#?}", urls);
        show_dashboard(handle.clone());

        if let Some(payload) = urls.first().and_then(extract_deep_link_data) {
            log::info!(
                "Received config data: {} apply={}",
                payload.data,
                payload.apply
            );
            // 写入 state（冷/热启动都靠前端主动拉取，保证可靠）
            store_pending_deep_link(&handle.state::<crate::app::state::AppData>(), payload);
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

// 断网时长低于此值视为短暂抖动，不触发重启
#[cfg(any(target_os = "windows", target_os = "macos"))]
const MIN_OUTAGE: std::time::Duration = std::time::Duration::from_secs(2);
// NetworkUp / DidWake 后等待此时长确认系统稳定，再执行重启
#[cfg(any(target_os = "windows", target_os = "macos"))]
const DEBOUNCE_SECS: u64 = 3;
// 睡眠时长 >= 此值才触发 wake 重启。30s 足以过滤"临时锁屏-解锁"
// 但会覆盖"开会合盖几分钟"这种真实场景。
#[cfg(any(target_os = "windows", target_os = "macos"))]
const WAKE_RESTART_THRESHOLD: std::time::Duration = std::time::Duration::from_secs(30);

/// 调度引擎重启：DEBOUNCE_SECS 秒后若 epoch 未变则 stop + start。
/// NetworkUp / DidWake 共用此路径，`ctx` 仅用于日志前缀区分触发源。
///
/// 调用方负责在调度前 `fetch_add(1)` 自增 epoch（幂等取消：后来的调度
/// 让之前已排队的任务读到不同 epoch，自动放弃）。
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn schedule_engine_restart(
    handle: tauri::AppHandle,
    epoch_arc: std::sync::Arc<std::sync::atomic::AtomicU64>,
    ctx: &'static str,
) {
    let current_epoch = epoch_arc.load(std::sync::atomic::Ordering::Relaxed);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(DEBOUNCE_SECS)).await;
        if epoch_arc.load(std::sync::atomic::Ordering::Relaxed) != current_epoch {
            log::info!("[{ctx}] epoch changed, aborting engine restart");
            return;
        }
        let Some((mode, path)) = crate::core::get_running_config() else {
            return;
        };
        log::info!("[{ctx}] restarting engine (mode: {:?})", mode);
        if let Err(e) = crate::core::stop(handle.clone()).await {
            log::error!("[{ctx}] stop engine failed: {}", e);
        } else if let Err(e) = crate::core::start(handle, path, mode).await {
            log::error!("[{ctx}] restart engine failed: {}", e);
        } else {
            log::info!("[{ctx}] engine restarted");
        }
    });
}

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
            let network_restart_epoch = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let mut network_down_at: Option<std::time::SystemTime> = None;
            // WillSleep 墙钟时间。DidWake 时与此值对比判断是否需要重启引擎。
            // NWPathMonitor 在睡眠期间挂起且带 satisfied 去重，Wi-Fi
            // 不 drop 的场景（Power Nap / 电源常连）唤醒后不会补发任何事件，
            // 恢复链路完全断在这里——所以不能只依赖 NetworkUp。
            let mut will_sleep_at: Option<std::time::SystemTime> = None;

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
                        log::info!("[wake] WillSleep");
                        will_sleep_at = Some(std::time::SystemTime::now());
                    }
                    SystemEvent::DidWake => {
                        let sleep_dur = will_sleep_at
                            .take()
                            .and_then(|t| t.elapsed().ok())
                            .unwrap_or_default();
                        log::info!(
                            "[wake] DidWake — slept {:.1}s",
                            sleep_dur.as_secs_f32()
                        );

                        // 幂等地刷一次 TUN DNS。睡眠期间 mDNSResponder 可能已被
                        // 系统回写为 DHCP 下发的服务器；这一次调用在非 TUN 模式
                        // 下是 no-op（见 on_network_up 里的 mode gate）。
                        use crate::engine::{EngineManager, PlatformEngine};
                        PlatformEngine::on_network_up(&handle);

                        if sleep_dur < WAKE_RESTART_THRESHOLD {
                            log::info!(
                                "[wake] sleep {:.1}s < threshold, skipping restart",
                                sleep_dur.as_secs_f32()
                            );
                            continue;
                        }

                        // 走和 NetworkUp 同一套 epoch + debounce：若期间又发
                        // NetworkDown/NetworkUp，epoch 自增会让本任务自动放弃。
                        network_restart_epoch
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        log::info!(
                            "[wake] sleep {:.1}s — scheduling engine restart in {}s",
                            sleep_dur.as_secs_f32(),
                            DEBOUNCE_SECS
                        );
                        schedule_engine_restart(
                            handle.clone(),
                            std::sync::Arc::clone(&network_restart_epoch),
                            "wake",
                        );
                    }
                    SystemEvent::NetworkDown => {
                        log::info!("[network] NetworkDown — cancelling any pending engine restart");
                        network_restart_epoch.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        network_down_at = Some(std::time::SystemTime::now());
                        // Release Setup DNS so OS-native captive detection on
                        // the next NetworkUp has a clean State layer to probe.
                        // macOS-only; Windows/Linux use trait default no-op.
                        // See docs/claude/dns-override.md.
                        use crate::engine::{EngineManager, PlatformEngine};
                        PlatformEngine::on_network_down(&handle);
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
                        use crate::engine::{EngineManager, PlatformEngine};
                        PlatformEngine::on_network_up(&handle);
                        let handle_for_retry = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            PlatformEngine::on_network_up(&handle_for_retry);
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
                        // 取消可能被 DidWake 预先排的 wake 重启——epoch 自增一次
                        // 后新旧两个已排队任务中只有我们刚刚捕获的那个能通过检查。
                        network_restart_epoch
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        schedule_engine_restart(
                            handle.clone(),
                            std::sync::Arc::clone(&network_restart_epoch),
                            "network",
                        );
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decide_suppress_missing_marker() {
        assert_eq!(
            decide_suppress_argv_deeplink(None, 1_700_000_000_000),
            SuppressDecision::Missing
        );
    }

    #[test]
    fn decide_suppress_malformed_marker_no_at_field() {
        let v = json!({ "foo": 1 });
        assert_eq!(
            decide_suppress_argv_deeplink(Some(&v), 1_700_000_000_000),
            SuppressDecision::Malformed
        );
    }

    #[test]
    fn decide_suppress_malformed_marker_wrong_type() {
        let v = json!({ "at": "not-a-number" });
        assert_eq!(
            decide_suppress_argv_deeplink(Some(&v), 1_700_000_000_000),
            SuppressDecision::Malformed
        );
    }

    #[test]
    fn decide_suppress_fresh_marker_within_ttl() {
        // 30s old — well within the 5-minute TTL.
        let at_ms: u64 = 1_700_000_000_000;
        let now_ms: u128 = at_ms as u128 + 30_000;
        let v = json!({ "at": at_ms });
        assert_eq!(
            decide_suppress_argv_deeplink(Some(&v), now_ms),
            SuppressDecision::Fresh { age_ms: 30_000 }
        );
    }

    #[test]
    fn decide_suppress_expired_marker_beyond_ttl() {
        // 10 minutes old — twice the TTL; must NOT suppress.
        let at_ms: u64 = 1_700_000_000_000;
        let now_ms: u128 = at_ms as u128 + 10 * 60 * 1000;
        let v = json!({ "at": at_ms });
        assert_eq!(
            decide_suppress_argv_deeplink(Some(&v), now_ms),
            SuppressDecision::Expired {
                age_ms: 10 * 60 * 1000
            }
        );
    }

    #[test]
    fn decide_suppress_ttl_boundary_is_exclusive() {
        // age == TTL → already expired (the `<` in the decision is intentional).
        let at_ms: u64 = 1_700_000_000_000;
        let now_ms: u128 = at_ms as u128 + UPDATE_SUPPRESS_TTL_MS;
        let v = json!({ "at": at_ms });
        assert_eq!(
            decide_suppress_argv_deeplink(Some(&v), now_ms),
            SuppressDecision::Expired {
                age_ms: UPDATE_SUPPRESS_TTL_MS
            }
        );
    }

    #[test]
    fn decide_suppress_clock_went_backwards() {
        // Marker timestamp sits in the "future" vs. now (NTP step after write).
        // Saturating subtraction clamps the age to 0, so the marker is treated
        // as fresh — preferring a false positive (one suppressed deep link)
        // over a false negative (re-import after update).
        let at_ms: u64 = 1_700_000_000_000;
        let now_ms: u128 = at_ms as u128 - 1_000;
        let v = json!({ "at": at_ms });
        assert_eq!(
            decide_suppress_argv_deeplink(Some(&v), now_ms),
            SuppressDecision::Fresh { age_ms: 0 }
        );
    }
}
