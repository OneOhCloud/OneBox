//! App-owned runtime configuration; the bundled kernel and the user's base stay untouched.
use onebox_windows_egress::{effective_config, native, probe, Policy};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub(crate) static OPERATIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static GENERATION: AtomicU64 = AtomicU64::new(0);
static FORCE_PROBE: AtomicBool = AtomicBool::new(false);
static RECONFIGURING: AtomicBool = AtomicBool::new(false);
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Clone)]
struct Session {
    generation: u64,
    base: String,
    effective: PathBuf,
    content: Value,
    policy: Policy,
}
fn session() -> Option<Session> {
    SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}
pub(crate) fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}
pub(crate) fn reconfiguring() -> bool {
    RECONFIGURING.load(Ordering::SeqCst)
}
pub(crate) fn network_up() {
    FORCE_PROBE.store(true, Ordering::SeqCst);
    native::notify();
}
pub(crate) fn cancel() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    native::notify();
}
pub(crate) fn effective_path() -> Option<PathBuf> {
    session()
        .filter(|session| session.generation == generation())
        .map(|session| session.effective)
}
struct MonitorLifetime(u64);
impl Drop for MonitorLifetime {
    fn drop(&mut self) {
        log::info!("[egress] monitor stopped generation={}", self.0);
    }
}
struct Reconfiguration;
impl Reconfiguration {
    fn begin() -> Self {
        RECONFIGURING.store(true, Ordering::SeqCst);
        Self
    }
}
impl Drop for Reconfiguration {
    fn drop(&mut self) {
        RECONFIGURING.store(false, Ordering::SeqCst);
    }
}

async fn read_base(path: &str) -> Result<Value, String> {
    serde_json::from_slice(
        &tokio::fs::read(path)
            .await
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

async fn prepare(base: &str, content: &Value, sidecar: &str) -> Result<PathBuf, String> {
    let directory = Path::new(base)
        .parent()
        .ok_or("configuration has no parent directory")?;
    let path = directory.join(format!("runtime-{}.json", uuid::Uuid::new_v4()));
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(content).map_err(|error| error.to_string())?;
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = tokio::fs::rename(&temporary, &path).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error.to_string());
    }
    let validation = async {
        let status = tokio::process::Command::new(sidecar)
            .args(["check", "-c"])
            .arg(&path)
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .status()
            .await
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("sing-box rejected the effective configuration".into())
        }
    };
    let result = tokio::time::timeout(Duration::from_secs(10), validation)
        .await
        .map_err(|_| "sing-box configuration validation timed out".to_string())
        .and_then(|result| result);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(error);
    }
    Ok(path)
}

fn tunnel_interfaces(base: &Value) -> Vec<String> {
    base["inbounds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|inbound| inbound["type"] == "tun")
        .filter_map(|inbound| inbound["interface_name"].as_str().map(str::to_owned))
        .collect()
}

async fn confirmed_policy(base: &Value, current: &Policy) -> Option<Policy> {
    let mut confirmation = probe::Confirmation::default();
    let mut preferred = current.clone();
    for _ in 0..2 {
        let network = native::snapshot(&tunnel_interfaces(base)).ok()?;
        let observation =
            probe::observe(Arc::new(native::NativeProbe), network.clone(), &preferred).await;
        if let Some(policy) = &observation {
            preferred = policy.clone();
        }
        if let Some(policy) = confirmation.observe(&network, observation, current) {
            return Some(policy);
        }
    }
    None
}

pub(crate) async fn start(base: &str, sidecar: &str) -> Result<String, String> {
    cancel();
    let base_content = read_base(base).await?;
    let preparation_started = std::time::Instant::now();
    let policy = confirmed_policy(&base_content, &Policy::SystemDefault)
        .await
        .unwrap_or(Policy::SystemDefault);
    let content = effective_config(&base_content, &policy)?;
    let path = prepare(base, &content, sidecar).await?;
    let session = Session {
        generation: generation(),
        base: base.into(),
        effective: path.clone(),
        content,
        policy,
    };
    log::info!(
        "[egress] initial policy: {:?}; preparation={}ms",
        session.policy,
        preparation_started.elapsed().as_millis()
    );
    let retired = SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .replace(session);
    if let Some(retired) = retired {
        let _ = tokio::fs::remove_file(retired.effective).await;
    }
    Ok(path.to_string_lossy().into_owned())
}

async fn wait_running(path: &Path) -> Result<(), String> {
    let content: Value = serde_json::from_slice(
        &tokio::fs::read(path)
            .await
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let port = content["inbounds"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["type"] == "mixed"))
        .and_then(|item| item["listen_port"].as_u64())
        .and_then(|port| u16::try_from(port).ok());
    // SCM reports Running immediately after spawning; give early kernel failures time to surface.
    tokio::time::sleep(Duration::from_secs(1)).await;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match tun_service::scm::query_state() {
                tun_service::scm::QueriedState::Running => {
                    if let Some(port) = port {
                        if matches!(
                            tokio::time::timeout(
                                Duration::from_millis(500),
                                tokio::net::TcpStream::connect((
                                    std::net::Ipv4Addr::LOCALHOST,
                                    port
                                ))
                            )
                            .await,
                            Ok(Ok(_))
                        ) {
                            return Ok(());
                        }
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    } else {
                        return Ok(());
                    }
                }
                tun_service::scm::QueriedState::Stopped
                | tun_service::scm::QueriedState::NotInstalled => {
                    return Err("TUN service stopped during reload".to_string())
                }
                _ => tokio::time::sleep(Duration::from_millis(200)).await,
            }
        }
    })
    .await
    .map_err(|_| "TUN service start timed out".to_string())?
}

async fn activate(sidecar: &str, path: &Path) -> Result<(), String> {
    let sidecar = sidecar.to_owned();
    let config_path = path.to_string_lossy().into_owned();
    tokio::task::spawn_blocking(move || super::restart_privileged_command(sidecar, config_path))
        .await
        .map_err(|error| error.to_string())??;
    wait_running(path).await
}

async fn apply(previous: Session, policy: Policy, sidecar: &str) -> Result<(), String> {
    let content = effective_config(&read_base(&previous.base).await?, &policy)?;
    if content == previous.content {
        *SESSION.lock().unwrap_or_else(|error| error.into_inner()) =
            Some(Session { policy, ..previous });
        return Ok(());
    }
    let path = prepare(&previous.base, &content, sidecar).await?;
    if generation() != previous.generation {
        let _ = tokio::fs::remove_file(path).await;
        return Ok(());
    }
    let _reload = Reconfiguration::begin();
    let replacement = onebox_windows_egress::transaction::replace(
        previous.effective.clone(),
        path.clone(),
        |config| async move { activate(sidecar, &config).await },
    )
    .await;
    if let Err(error) = replacement {
        let _ = tokio::fs::remove_file(path).await;
        return Err(error);
    }
    *SESSION.lock().unwrap_or_else(|error| error.into_inner()) = Some(Session {
        effective: path,
        content,
        policy: policy.clone(),
        ..previous.clone()
    });
    let _ = tokio::fs::remove_file(previous.effective).await;
    log::info!("[egress] activated policy: {policy:?}");
    Ok(())
}

pub(crate) async fn reload(sidecar: &str) -> Result<(), String> {
    let previous = session().ok_or("no active TUN configuration")?;
    let policy = confirmed_policy(&read_base(&previous.base).await?, &previous.policy)
        .await
        .unwrap_or(previous.policy.clone());
    apply(previous, policy, sidecar).await
}

pub(crate) fn monitor(sidecar: String) {
    let captured = generation();
    tokio::spawn(async move {
        let _lifetime = MonitorLifetime(captured);
        log::info!("[egress] monitor started generation={captured}");
        let _notifications = native::Notifications::register()
            .map_err(|error| log::warn!("[egress] notifications unavailable: {error}"));
        let mut confirmation = probe::Confirmation::default();
        let mut last_network = String::new();
        let mut interval = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_secs(60),
            Duration::from_secs(60),
        );
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            let periodic = tokio::select! {
                _ = interval.tick() => true,
                _ = native::changed() => false,
            };
            if generation() != captured {
                return;
            }
            let Some(previous) = session() else {
                return;
            };
            let interfaces = tunnel_interfaces(&previous.content);
            let Ok(network) = native::snapshot(&interfaces) else {
                confirmation = Default::default();
                continue;
            };
            if !FORCE_PROBE.swap(false, Ordering::SeqCst)
                && !periodic
                && network.identity == last_network
            {
                continue;
            }
            last_network = network.identity.clone();
            let observation = probe::observe(
                Arc::new(native::NativeProbe),
                network.clone(),
                &previous.policy,
            )
            .await;
            log::debug!("[egress] observation: {observation:?}");
            let Some(policy) = confirmation.observe(&network, observation, &previous.policy) else {
                continue;
            };
            let _operation = OPERATIONS.lock().await;
            let active_tun = {
                let manager = crate::core::ProcessManager::acquire();
                !manager.is_stopping
                    && manager
                        .mode
                        .as_ref()
                        .is_some_and(|mode| matches!(**mode, crate::engine::ProxyMode::TunProxy))
            };
            if generation() != captured || !active_tun {
                return;
            }
            // Re-read after acquiring the lifecycle lock; a manual reload may have won the race.
            let Some(previous) = session() else {
                return;
            };
            if native::snapshot(&interfaces)
                .map(|latest| latest.identity != network.identity)
                .unwrap_or(true)
            {
                confirmation = Default::default();
                continue;
            }
            if let Err(error) = apply(previous, policy, &sidecar).await {
                log::warn!("[egress] {error}");
                // Stop automatic retries after an activation failure; the next explicit start/reload can retry.
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejected_validation_removes_runtime_file_and_preserves_base() {
        let directory = tempfile::tempdir().unwrap();
        let base = directory.path().join("config.json");
        let original = b"{\"dns\":{\"strategy\":\"prefer_ipv4\"}}";
        std::fs::write(&base, original).unwrap();
        let content =
            serde_json::json!({"outbounds":[{"type":"direct","bind_interface":"以太网"}]});
        assert!(prepare(
            base.to_str().unwrap(),
            &content,
            "Z:\\nonexistent-onebox-test\\sing-box.exe"
        )
        .await
        .is_err());
        assert_eq!(std::fs::read(&base).unwrap(), original);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
