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
/// Compresses previous days' logs and removes logs older than 7 days.
pub(super) fn create_singbox_log_writer(app: &AppHandle) -> Option<std::fs::File> {
    let log_dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&log_dir).ok()?;

    cleanup_old_singbox_logs(&log_dir, 7);

    let date = today_date_string();
    let log_path = log_dir.join(format!("sing-box-{}.log", date));

    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("sing-box-")
                && name_str.ends_with(".log")
                && !name_str.contains(&date)
            {
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
