//! Subscription config fetcher with optimal-DNS pinning + CDN accelerator
//! fallback. Used by the frontend when importing a subscription URL.
//!
//! Primary path: resolve host against the fastest public DNS
//! (`commands::dns::get_best_dns_server`), pin the IP into reqwest, GET
//! the URL. Fallback: if the primary connect/timeout fails AND the
//! subscription host is on the whitelist AND the compile-time accelerator
//! endpoint is reachable, retry through
//! `<ACCELERATE_URL>/<domain_sha256><path>?<query>`.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};

use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use url::Url;

use super::dns::{get_best_dns_server, is_ip_address, resolve_a_record};
use super::whitelist::{load_whitelist_hashes, KNOWN_HOST_SHA256_LIST};

// Compile-time accelerator URL — injected from ACCELERATE_URL env var via build.rs.
// Empty string when not configured.
const ACCELERATE_URL: &str = env!("ACCELERATE_URL");

fn compute_sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(s.as_bytes());
    hash.iter().map(|b| format!("{:02x}", b)).collect()
}

/// True iff `domain_sha256` matches any compile-time constant OR any entry
/// in the locally-cached whitelist (refreshed in the background every 24 h).
/// Never performs a network request.
fn verify_domain_sha256(domain_sha256: &str, app: &AppHandle) -> bool {
    if KNOWN_HOST_SHA256_LIST.contains(&domain_sha256) {
        return true;
    }
    load_whitelist_hashes(app)
        .iter()
        .any(|h| h == domain_sha256)
}

/// Probes TCP:443 reachability of the compiled-in ACCELERATE_URL (5 s timeout).
async fn check_accelerator_tcp() -> bool {
    if ACCELERATE_URL.is_empty() {
        return false;
    }
    let Ok(parsed) = Url::parse(ACCELERATE_URL) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let addr = format!("{}:443", host);
    matches!(
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::net::TcpStream::connect(&addr),
        )
        .await,
        Ok(Ok(_))
    )
}

/// Rewrites `original_url` into its accelerated form:
///   `<ACCELERATE_URL>/<domain_sha256><path>?<query>`
fn build_accelerated_url(original_url: &str, domain_sha256: &str) -> Option<String> {
    if ACCELERATE_URL.is_empty() {
        return None;
    }
    let parsed = Url::parse(original_url).ok()?;
    let path = parsed.path().to_string();
    let query_part = parsed
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let base = ACCELERATE_URL.trim_end_matches('/');
    Some(format!("{}/{}{}{}", base, domain_sha256, path, query_part))
}

fn collect_headers(headers: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|v| (name.to_string(), v.to_string()))
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct FetchConfigResponse {
    data: Option<serde_json::Value>,
    headers: HashMap<String, String>,
    status: u16,
}

#[tauri::command]
pub async fn fetch_config_with_optimal_dns(
    app: AppHandle,
    url: String,
    user_agent: String,
) -> Result<FetchConfigResponse, String> {
    use crate::state::AppData;

    let parsed_url = Url::parse(&url).map_err(|e| e.to_string())?;
    let hostname = parsed_url
        .host_str()
        .ok_or("missing host in URL")?
        .to_string();
    let port = parsed_url.port_or_known_default().unwrap_or(443);

    // Verification failure only disables the accelerator fallback; the
    // primary request is always attempted regardless of the outcome.
    let domain_sha256 = compute_sha256_hex(&hostname);
    let domain_verified = verify_domain_sha256(&domain_sha256, &app);
    if !domain_verified {
        log::warn!(
            "[CONFIG_LOAD] 方式=VERIFICATION_FAILED, 域名={}, 域名SHA256={}, 加速地址已禁用",
            hostname,
            domain_sha256
        );
    }

    // Build primary client with optimal DNS — use the cached value while
    // sing-box is running (probing through the proxy would misrank).
    let app_data = app.state::<AppData>();
    let dns_server = {
        let running = crate::core::is_running(app.clone(), app_data.get_clash_secret().unwrap()).await;
        if running {
            app_data.get_cached_dns()
        } else {
            None
        }
    };
    let dns_server = match dns_server {
        Some(d) => d,
        None => {
            let best = get_best_dns_server()
                .await
                .unwrap_or_else(|| "223.5.5.5".to_string());
            app_data.set_cached_dns(Some(best.clone()));
            best
        }
    };

    let client_builder = reqwest::ClientBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy();

    let primary_client = if !is_ip_address(&hostname) {
        match resolve_a_record(&hostname, &dns_server).await {
            Some(ip) => {
                let addr = SocketAddr::new(IpAddr::V4(ip), port);
                log::info!("Resolved {} -> {} via DNS {}", hostname, ip, dns_server);
                client_builder
                    .resolve(&hostname, addr)
                    .build()
                    .map_err(|e| e.to_string())?
            }
            None => {
                log::warn!(
                    "DNS resolution failed for {} via {}, falling back to system DNS",
                    hostname,
                    dns_server
                );
                client_builder.build().map_err(|e| e.to_string())?
            }
        }
    } else {
        client_builder.build().map_err(|e| e.to_string())?
    };

    match primary_client
        .get(&url)
        .header("User-Agent", &user_agent)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status().as_u16();
            let headers = collect_headers(response.headers());
            let data = if status == 200 {
                response
                    .bytes()
                    .await
                    .ok()
                    .and_then(|b| serde_json::from_slice(&b).ok())
            } else {
                None
            };
            log::info!("[CONFIG_LOAD] 方式=PRIMARY, URL={}", url);
            Ok(FetchConfigResponse {
                data,
                headers,
                status,
            })
        }
        Err(primary_err) if primary_err.is_connect() || primary_err.is_timeout() => {
            let primary_reason = if primary_err.is_timeout() {
                "TIMEOUT".to_string()
            } else {
                format!("CONNECT_ERROR({})", primary_err)
            };
            log::warn!("[CONFIG_LOAD] 主地址失败: {}, URL={}", primary_reason, url);

            // Three conditions must all hold for the fallback:
            // accelerator URL compiled in, domain verification passed,
            // and TCP:443 reachable.
            if ACCELERATE_URL.is_empty() {
                log::warn!(
                    "[CONFIG_LOAD] 方式=ACCELERATOR_UNAVAILABLE, 原因=未配置加速地址, 回退中止"
                );
                return Err(format!(
                    "[CONFIG_LOAD] PRIMARY_FAILED: {}, no accelerator configured",
                    primary_reason
                ));
            }

            if !domain_verified {
                log::warn!(
                    "[CONFIG_LOAD] 方式=ACCELERATOR_UNAVAILABLE, 原因=域名未通过验证, 回退中止"
                );
                return Err(format!(
                    "[CONFIG_LOAD] PRIMARY_FAILED: {}, domain not verified, accelerator disabled",
                    primary_reason
                ));
            }

            if !check_accelerator_tcp().await {
                log::warn!("[CONFIG_LOAD] 方式=ACCELERATOR_UNAVAILABLE, 原因=不可达:443, 回退中止");
                return Err(format!(
                    "[CONFIG_LOAD] PRIMARY_FAILED: {}, accelerator unreachable",
                    primary_reason
                ));
            }

            let Some(accelerated_url) = build_accelerated_url(&url, &domain_sha256) else {
                return Err(format!(
                    "[CONFIG_LOAD] PRIMARY_FAILED: {}, cannot build accelerated URL",
                    primary_reason
                ));
            };

            let fallback_client = reqwest::ClientBuilder::new()
                .timeout(std::time::Duration::from_secs(30))
                .no_proxy()
                .build()
                .map_err(|e| e.to_string())?;

            match fallback_client
                .get(&accelerated_url)
                .header("User-Agent", &user_agent)
                .send()
                .await
            {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let headers = collect_headers(response.headers());
                    if status == 200 {
                        let data = response
                            .bytes()
                            .await
                            .ok()
                            .and_then(|b| serde_json::from_slice(&b).ok());
                        log::info!(
                            "[CONFIG_LOAD] 方式=FALLBACK_ACCELERATOR, 原因={}, 加速URL={}",
                            primary_reason,
                            accelerated_url
                        );
                        Ok(FetchConfigResponse {
                            data,
                            headers,
                            status,
                        })
                    } else {
                        log::warn!(
                            "[CONFIG_LOAD] 方式=BOTH_FAILED, 主地址原因={}, 加速地址原因=HTTP_{}",
                            primary_reason,
                            status
                        );
                        Ok(FetchConfigResponse {
                            data: None,
                            headers,
                            status,
                        })
                    }
                }
                Err(acc_err) => {
                    let acc_reason = if acc_err.is_timeout() {
                        "TIMEOUT".to_string()
                    } else {
                        format!("CONNECT_ERROR({})", acc_err)
                    };
                    log::error!(
                        "[CONFIG_LOAD] 方式=BOTH_FAILED, 主地址原因={}, 加速地址原因={}",
                        primary_reason,
                        acc_reason
                    );
                    Err(format!(
                        "[CONFIG_LOAD] BOTH_FAILED: primary={}, accelerator={}",
                        primary_reason, acc_reason
                    ))
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}
