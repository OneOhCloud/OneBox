use serde::Serialize;
use std::process::Command;
use std::time::{Duration, Instant};

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

fn find_pids_on_port_6789() -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        find_pids_windows()
    }
    #[cfg(target_os = "macos")]
    {
        find_pids_macos()
    }
    #[cfg(target_os = "linux")]
    {
        find_pids_linux()
    }
}

#[cfg(target_os = "windows")]
fn find_pids_windows() -> Vec<u32> {
    let output = Command::new("netstat")
        .args(["-ano"])
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });

    let text = String::from_utf8_lossy(&output.stdout);
    let mut pids = Vec::new();

    for line in text.lines() {
        if !line.contains(":6789") {
            continue;
        }
        if !line.to_uppercase().contains("LISTENING") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
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
fn find_pids_macos() -> Vec<u32> {
    let output = Command::new("lsof")
        .args(["-ti", "TCP:6789", "-sTCP:LISTEN"])
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
fn find_pids_linux() -> Vec<u32> {
    let output = Command::new("fuser")
        .args(["6789/tcp"])
        .output();

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

fn kill_pid(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(unix)]
    {
        let ret = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        ret == 0
    }
}

#[tauri::command]
pub fn prestart_check() -> PrestartCheckResult {
    let port_occupied = crate::core::probe_mixed_port_listening();
    let orphan_pids = if port_occupied {
        find_pids_on_port_6789()
    } else {
        vec![]
    };
    log::info!(
        "[prestart] check: port_occupied={} orphan_pids={:?}",
        port_occupied,
        orphan_pids
    );
    PrestartCheckResult {
        port_occupied,
        orphan_pids,
    }
}

#[tauri::command]
pub fn kill_orphans() -> KillOrphansResult {
    let check = prestart_check();

    if !check.port_occupied || check.orphan_pids.is_empty() {
        return KillOrphansResult {
            success: true,
            killed_pids: vec![],
            port_released: true,
            message: String::from("no orphans found"),
        };
    }

    let mut killed_pids = Vec::new();
    for pid in &check.orphan_pids {
        if kill_pid(*pid) {
            killed_pids.push(*pid);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(3);
    let port_released = loop {
        if !crate::core::probe_mixed_port_listening() {
            break true;
        }
        if Instant::now() >= deadline {
            break false;
        }
        std::thread::sleep(Duration::from_millis(200));
    };

    let message = if port_released {
        format!("killed {:?}, port released", killed_pids)
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
