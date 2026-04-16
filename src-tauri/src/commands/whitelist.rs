//! Subscription-host SHA256 whitelist — refreshed in the background from
//! sing-box.net and consumed by `config_fetch::verify_domain_sha256`.
//!
//! A compile-time constant list of hashes ships in the binary; at runtime
//! we additionally pull a live list so new hosts can be approved without
//! a client update. The live list is persisted via `tauri-plugin-store`
//! so an offline restart still has the last known whitelist on hand.

use serde_json::json;
use tauri::{AppHandle, Wry};
use tauri_plugin_http::reqwest;
use tauri_plugin_store::StoreExt;

/// Compile-time known-good SHA256 list. Add entries here as hosts are
/// approved in-tree; the remote list is the looser/faster path.
pub(crate) const KNOWN_HOST_SHA256_LIST: &[&str] = &[
    "183a5526e76751b07cd57236bc8f253d5424e02a3fc7da7c30f80919e975125a",
    "59fe86216c23236fb4c6ab50cd8d1e261b7cad754e3e7cab33058df5b32d12e1",
];

const WHITELIST_REMOTE_URL: &str = "https://www.sing-box.net/verified_subscriptions_sha256.txt";
const WHITELIST_STORE_NAME: &str = "whitelist_cache.json";
const WHITELIST_KEY_HASHES: &str = "hashes";
const WHITELIST_KEY_UPDATED_AT: &str = "updated_at";
/// Minimum age (seconds) before the cache is considered stale and re-fetched.
const WHITELIST_TTL_SECS: u64 = 24 * 3600;
/// How often the background task wakes up to check staleness.
const WHITELIST_CHECK_INTERVAL_SECS: u64 = 6 * 3600;

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

async fn fetch_whitelist_from_remote() -> Option<Vec<String>> {
    let client = match reqwest::ClientBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[WHITELIST] Failed to build HTTP client: {}", e);
            return None;
        }
    };
    match client.get(WHITELIST_REMOTE_URL).send().await {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(text) => {
                let hashes: Vec<String> = text
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect();
                log::info!("[WHITELIST] Fetched {} entries from remote", hashes.len());
                Some(hashes)
            }
            Err(e) => {
                log::warn!("[WHITELIST] Failed to read response body: {}", e);
                None
            }
        },
        Ok(resp) => {
            log::warn!(
                "[WHITELIST] Remote returned unexpected status {}",
                resp.status()
            );
            None
        }
        Err(e) => {
            log::warn!("[WHITELIST] Remote fetch failed: {}", e);
            None
        }
    }
}

fn open_whitelist_store(
    app: &AppHandle<Wry>,
) -> Option<std::sync::Arc<tauri_plugin_store::Store<Wry>>> {
    match app.store(WHITELIST_STORE_NAME) {
        Ok(s) => Some(s),
        Err(e) => {
            log::warn!("[WHITELIST] Failed to open store: {}", e);
            None
        }
    }
}

pub(crate) fn load_whitelist_hashes(app: &AppHandle<Wry>) -> Vec<String> {
    open_whitelist_store(app)
        .and_then(|s| s.get(WHITELIST_KEY_HASHES))
        .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
        .unwrap_or_default()
}

fn load_whitelist_timestamp(app: &AppHandle<Wry>) -> Option<u64> {
    open_whitelist_store(app)
        .and_then(|s| s.get(WHITELIST_KEY_UPDATED_AT))
        .and_then(|v| v.as_u64())
}

fn save_whitelist_cache(app: &AppHandle<Wry>, hashes: &[String]) {
    let Some(store) = open_whitelist_store(app) else {
        return;
    };
    store.set(WHITELIST_KEY_HASHES, json!(hashes));
    store.set(WHITELIST_KEY_UPDATED_AT, json!(now_unix_secs()));
    if let Err(e) = store.save() {
        log::warn!("[WHITELIST] Failed to persist store to disk: {}", e);
    }
}

async fn refresh_whitelist_if_stale(app: &AppHandle<Wry>) {
    let stale = match load_whitelist_timestamp(app) {
        None => true,
        Some(ts) => now_unix_secs().saturating_sub(ts) >= WHITELIST_TTL_SECS,
    };
    if !stale {
        log::debug!("[WHITELIST] Cache is fresh, skipping refresh");
        return;
    }
    log::info!("[WHITELIST] Cache is stale, fetching from remote...");
    match fetch_whitelist_from_remote().await {
        Some(hashes) => save_whitelist_cache(app, &hashes),
        None => log::warn!("[WHITELIST] Remote fetch failed, retaining existing cache"),
    }
}

/// Call once during app setup. Refreshes the remote whitelist every 24 h
/// via a background loop that wakes every `WHITELIST_CHECK_INTERVAL_SECS`.
pub fn spawn_whitelist_refresh_task(app: AppHandle<Wry>) {
    tauri::async_runtime::spawn(async move {
        loop {
            refresh_whitelist_if_stale(&app).await;
            tokio::time::sleep(std::time::Duration::from_secs(
                WHITELIST_CHECK_INTERVAL_SECS,
            ))
            .await;
        }
    });
}
