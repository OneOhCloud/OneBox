use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{Read, Write};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Howard Hinnant's algorithm: Unix days → civil date (UTC).
pub(super) fn today_date_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let z = secs as i64 / 86400 + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn compress_singbox_log(log_path: &Path) -> std::io::Result<()> {
    const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

    if let Ok(meta) = std::fs::metadata(log_path) {
        if meta.len() > MAX_LOG_SIZE {
            let compressed_path = log_path.with_extension("log.gz");
            let mut input_file = std::fs::File::open(log_path)?;
            let compressed_file = std::fs::File::create(&compressed_path)?;
            let mut encoder = GzEncoder::new(compressed_file, Compression::default());

            let mut buffer = vec![0; 8192];
            loop {
                let n = input_file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                encoder.write_all(&buffer[..n])?;
            }

            encoder.finish()?;
            std::fs::remove_file(log_path)?;
            log::info!("Compressed sing-box log to: {}", compressed_path.display());
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn cleanup_old_singbox_logs(log_dir: &Path, keep_days: u64) {
    let entries = match std::fs::read_dir(log_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(keep_days * 86400);

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let path = entry.path();

        if name_str.starts_with("sing-box-")
            && (name_str.ends_with(".log") || name_str.ends_with(".log.gz"))
        {
            if let Ok(meta) = entry.metadata() {
                let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
                if modified < cutoff {
                    let _ = std::fs::remove_file(&path);
                    log::info!("Removed old sing-box log: {}", name_str);
                }
            }
        }
    }
}

/// Create a daily-rotated log file writer for sing-box output.
/// In a single directory scan: removes logs older than 7 days, compresses
/// previous days' logs that are still uncompressed.
pub(super) fn create_singbox_log_writer(app: &AppHandle) -> Option<std::fs::File> {
    let log_dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&log_dir).ok()?;

    let date = today_date_string();
    let log_path = log_dir.join(format!("sing-box-{}.log", date));
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(7 * 86400);

    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if !name_str.starts_with("sing-box-") {
                continue;
            }

            let is_log = name_str.ends_with(".log");
            let is_gz = name_str.ends_with(".log.gz");
            if !is_log && !is_gz {
                continue;
            }

            // Prune old logs (both .log and .log.gz)
            if let Ok(meta) = entry.metadata() {
                let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                    log::info!("Removed old sing-box log: {}", name_str);
                    continue;
                }
            }

            // Compress previous days' uncompressed logs
            if is_log && !name_str.contains(&date) {
                let _ = compress_singbox_log(&entry.path());
            }
        }
    }

    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| log::error!("Failed to open {}: {}", log_path.display(), e))
        .ok()
}

/// Append a line to the sing-box log file.
pub(super) fn write_singbox_log(writer: &mut Option<std::fs::File>, line: &str) {
    if let Some(ref mut file) = writer {
        let _ = writeln!(file, "{}", line);
    }
}

/// Delete rotated OneBox app logs older than 7 days.
///
/// Companion to the `tauri-plugin-log` configuration in `app::plugins`
/// (`RotationStrategy::KeepAll`). The plugin rotates by size only, so
/// without this sweep rotated files accumulate forever. Files are left
/// uncompressed intentionally — `OneBox.log` is grep-driven triage
/// material and the triage script must be able to read it directly.
///
/// Only rotated archives (`OneBox_<timestamp>.log`) are subject to
/// deletion; the live `OneBox.log` is always preserved regardless of
/// mtime — the plugin holds it open and deleting it would corrupt the
/// writer. Oneshot: call once at `app_setup`; not re-entered per log
/// write.
pub fn cleanup_old_onebox_logs(app: &AppHandle) {
    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if !log_dir.exists() {
        return;
    }
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(7 * 86400);
    sweep_onebox_logs(&log_dir, cutoff);
}

/// Pure filesystem sweep — split from `cleanup_old_onebox_logs` so unit
/// tests can exercise it without a real `AppHandle`.
fn sweep_onebox_logs(log_dir: &Path, cutoff: std::time::SystemTime) {
    let entries = match std::fs::read_dir(log_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Rotated archive only: "OneBox_<timestamp>.log". Active file
        // "OneBox.log" is never touched — see fn doc.
        if !(name_str.starts_with("OneBox_") && name_str.ends_with(".log")) {
            continue;
        }

        if let Ok(meta) = entry.metadata() {
            let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
            if modified < cutoff {
                if let Err(e) = std::fs::remove_file(entry.path()) {
                    log::warn!("Failed to remove old OneBox log {}: {}", name_str, e);
                } else {
                    log::info!("Removed old OneBox log: {}", name_str);
                }
            }
        }
    }
}

#[cfg(test)]
mod onebox_log_sweep_tests {
    use super::sweep_onebox_logs;
    use std::fs::File;
    use std::time::{Duration, SystemTime};

    fn touch(path: &std::path::Path, age_days: u64) {
        File::create(path).expect("create test log");
        let mtime = SystemTime::now() - Duration::from_secs(age_days * 86400);
        filetime::set_file_mtime(path, filetime::FileTime::from_system_time(mtime))
            .expect("set mtime");
    }

    #[test]
    fn removes_rotated_logs_older_than_cutoff() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();

        let active = dir.join("OneBox.log");
        let recent = dir.join("OneBox_2026-04-20_00-00-00.log");
        let stale = dir.join("OneBox_2026-04-01_00-00-00.log");
        let singbox = dir.join("sing-box-2026-04-01.log");
        let unrelated = dir.join("other.log");

        touch(&active, 30);
        touch(&recent, 1);
        touch(&stale, 30);
        touch(&singbox, 30);
        touch(&unrelated, 30);

        let cutoff = SystemTime::now() - Duration::from_secs(7 * 86400);
        sweep_onebox_logs(dir, cutoff);

        assert!(active.exists(), "active OneBox.log must never be deleted");
        assert!(recent.exists(), "recent rotated log must survive");
        assert!(!stale.exists(), "stale rotated log must be removed");
        assert!(singbox.exists(), "sing-box logs are owned by a different sweep");
        assert!(unrelated.exists(), "unrelated files must not be touched");
    }
}
