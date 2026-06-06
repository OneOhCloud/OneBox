use serde::Serialize;
use std::fmt;
use std::process::Command;
use std::time::{Duration, Instant};

pub const PORT_OCCUPIED_CANNOT_START: &str = "PORT_OCCUPIED_CANNOT_START";

#[derive(Serialize)]
pub struct PrestartCheckResult {
    pub port_occupied: bool,
    pub orphan_pids: Vec<u32>,
}

#[derive(Serialize)]
pub struct KillOrphansResult {
    pub success: bool,
    pub killed_pids: Vec<u32>,
    pub port_released: bool,
    pub message: String,
}

pub(crate) struct PortCleanupResult {
    pub killed_pids: Vec<u32>,
    pub port_released: bool,
}

#[derive(Debug)]
pub(crate) enum PortCleanupError {
    NoKillableProcess {
        port: u16,
    },
    PortStillOccupied {
        port: u16,
        pids: Vec<u32>,
        killed_pids: Vec<u32>,
        kill_errors: Vec<String>,
    },
}

impl PortCleanupError {
    pub(crate) fn start_error(&self) -> String {
        format!(
            "{}:{}: port is occupied and OneBox could not stop the process",
            PORT_OCCUPIED_CANNOT_START,
            self.port()
        )
    }

    fn port(&self) -> u16 {
        match self {
            Self::NoKillableProcess { port } => *port,
            Self::PortStillOccupied { port, .. } => *port,
        }
    }
}

impl fmt::Display for PortCleanupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoKillableProcess { port } => {
                write!(f, "port {port} is occupied but no killable listener PID was found")
            }
            Self::PortStillOccupied {
                port,
                pids,
                killed_pids,
                kill_errors,
            } => write!(
                f,
                "port {port} is still occupied after cleanup; pids={pids:?}, killed={killed_pids:?}, errors={kill_errors:?}"
            ),
        }
    }
}

fn find_pids_on_port(port: u16) -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        find_pids_windows(port)
    }
    #[cfg(target_os = "macos")]
    {
        find_pids_macos(port)
    }
    #[cfg(target_os = "linux")]
    {
        find_pids_linux(port)
    }
}

#[cfg(target_os = "windows")]
fn find_pids_windows(port: u16) -> Vec<u32> {
    let Ok(output) = Command::new("netstat").args(["-ano"]).output() else {
        return vec![];
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut pids = Vec::new();
    let port_str = port.to_string();

    for line in text.lines() {
        if !line.to_uppercase().contains("LISTENING") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        let Some(local_addr) = parts.get(1) else {
            continue;
        };
        if local_addr.rsplit(':').next() != Some(port_str.as_str()) {
            continue;
        }
        if let Some(pid_str) = parts.last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid != 0 && !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
    }
    pids
}

#[cfg(target_os = "macos")]
fn find_pids_macos(port: u16) -> Vec<u32> {
    let port_arg = format!("TCP:{port}");
    let output = Command::new("lsof")
        .args(["-ti", &port_arg, "-sTCP:LISTEN"])
        .output();

    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            text.lines()
                .filter_map(|l| l.trim().parse::<u32>().ok())
                .collect()
        }
        Err(_) => vec![],
    }
}

#[cfg(target_os = "linux")]
fn find_pids_linux(port: u16) -> Vec<u32> {
    let port_arg = format!("{port}/tcp");
    let output = Command::new("fuser").arg(port_arg).output();

    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let stderr_text = String::from_utf8_lossy(&out.stderr);
            let combined = format!("{}{}", text, stderr_text);
            combined
                .split_whitespace()
                .filter_map(|s| s.parse::<u32>().ok())
                .collect()
        }
        Err(_) => vec![],
    }
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(if stderr.is_empty() { stdout } else { stderr })
        }
    }
    #[cfg(unix)]
    {
        let ret = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        if ret == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error().to_string())
        }
    }
}

pub(crate) fn ensure_port_available(port: u16) -> Result<PortCleanupResult, PortCleanupError> {
    if !crate::core::probe_port_listening(port) {
        return Ok(PortCleanupResult {
            killed_pids: vec![],
            port_released: true,
        });
    }

    let pids = find_pids_on_port(port);
    if pids.is_empty() {
        return Err(PortCleanupError::NoKillableProcess { port });
    }

    let mut killed_pids = Vec::new();
    let mut kill_errors = Vec::new();
    for pid in &pids {
        match kill_pid(*pid) {
            Ok(()) => killed_pids.push(*pid),
            Err(e) => kill_errors.push(format!("pid {}: {}", pid, e)),
        }
    }

    let deadline = Instant::now() + Duration::from_secs(3);
    let port_released = loop {
        if !crate::core::probe_port_listening(port) {
            break true;
        }
        if Instant::now() >= deadline {
            break false;
        }
        std::thread::sleep(Duration::from_millis(200));
    };

    if port_released {
        Ok(PortCleanupResult {
            killed_pids,
            port_released,
        })
    } else {
        Err(PortCleanupError::PortStillOccupied {
            port,
            pids,
            killed_pids,
            kill_errors,
        })
    }
}

#[tauri::command]
pub fn prestart_check(app: tauri::AppHandle, port: Option<u16>) -> PrestartCheckResult {
    let port = port.unwrap_or_else(|| crate::core::mixed_proxy_port(&app));
    let port_occupied = crate::core::probe_port_listening(port);
    let orphan_pids = if port_occupied {
        find_pids_on_port(port)
    } else {
        vec![]
    };
    log::info!(
        "[prestart] check: port={} port_occupied={} orphan_pids={:?}",
        port,
        port_occupied,
        orphan_pids
    );
    PrestartCheckResult {
        port_occupied,
        orphan_pids,
    }
}

#[tauri::command]
pub fn kill_orphans(app: tauri::AppHandle, port: Option<u16>) -> KillOrphansResult {
    let port = port.unwrap_or_else(|| crate::core::mixed_proxy_port(&app));
    let check = prestart_check(app, Some(port));

    if !check.port_occupied {
        return KillOrphansResult {
            success: true,
            killed_pids: vec![],
            port_released: true,
            message: String::from("no orphans found"),
        };
    }

    if check.orphan_pids.is_empty() {
        let error = PortCleanupError::NoKillableProcess { port };
        return KillOrphansResult {
            success: false,
            killed_pids: vec![],
            port_released: false,
            message: error.start_error(),
        };
    }

    let cleanup = ensure_port_available(port);
    let (killed_pids, port_released, error_message) = match cleanup {
        Ok(result) => (result.killed_pids, result.port_released, None),
        Err(e) => {
            log::warn!("[prestart] kill_orphans failed: {}", e);
            let killed_pids = match &e {
                PortCleanupError::PortStillOccupied { killed_pids, .. } => killed_pids.clone(),
                PortCleanupError::NoKillableProcess { .. } => Vec::new(),
            };
            (killed_pids, false, Some(e.start_error()))
        }
    };

    let message = if port_released {
        format!("killed {:?}, port released", killed_pids)
    } else if let Some(error_message) = error_message {
        error_message
    } else {
        format!("killed {:?}, port still occupied", killed_pids)
    };

    log::info!(
        "[prestart] kill_orphans: killed={:?} port_released={}",
        killed_pids,
        port_released
    );

    KillOrphansResult {
        success: port_released,
        killed_pids,
        port_released,
        message,
    }
}
