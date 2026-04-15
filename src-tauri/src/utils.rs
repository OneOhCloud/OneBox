use std::fs;
use std::io::ErrorKind;
use tauri::{AppHandle, Manager};

/// Delete legacy v1 cache files (including the historical `gloabl` typo) left over from
/// pre-v2 clients. Never fails app startup.
pub fn purge_legacy_cache_files(app: &AppHandle) {
    let config_dir = match app.path().app_config_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("[cache-migrate] cannot resolve app config dir: {}", e);
            return;
        }
    };

    // Include sqlite WAL/shm sidecars — written next to every .db.
    let legacy_names = [
        "mixed-cache-rule-v1.db",
        "mixed-cache-rule-v1.db-wal",
        "mixed-cache-rule-v1.db-shm",
        "tun-cache-rule-v1.db",
        "tun-cache-rule-v1.db-wal",
        "tun-cache-rule-v1.db-shm",
        "tun-cache-global-v1.db",
        "tun-cache-global-v1.db-wal",
        "tun-cache-global-v1.db-shm",
        "mixed-cache-gloabl-v1.db",
        "mixed-cache-gloabl-v1.db-wal",
        "mixed-cache-gloabl-v1.db-shm",
    ];

    for name in legacy_names {
        let target = config_dir.join(name);
        match fs::remove_file(&target) {
            Ok(_) => log::info!("[cache-migrate] removed legacy cache file: {:?}", target),
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => log::warn!("[cache-migrate] failed to remove {:?}: {}", target, e),
        }
    }
}

// 复制 resources 目录下的 .db 文件到 appConfigDir
pub fn copy_database_files(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 获取 resource 目录路径
    let resource_dir = app.path().resource_dir()?;
    let resources_path = resource_dir.join("resources");

    // 获取 appConfigDir 路径
    let config_dir = app.path().app_config_dir()?;

    // 确保 appConfigDir 存在
    fs::create_dir_all(&config_dir)?;

    log::info!(
        "Copying database files from {:?} to {:?}",
        resources_path,
        config_dir
    );

    // 检查 resources 目录是否存在
    if !resources_path.exists() {
        log::warn!("Resources directory does not exist: {:?}", resources_path);
        return Ok(());
    }

    // 读取 resources 目录下的所有文件
    for entry in fs::read_dir(&resources_path)? {
        let entry = entry?;
        let path = entry.path();

        // 只处理 .db 文件
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("db") {
            let file_name = path.file_name().ok_or("Failed to get file name")?;
            let dest_path = config_dir.join(file_name);

            // 只在目标文件不存在时复制（避免覆盖用户数据）
            if !dest_path.exists() {
                log::info!("Copying {:?} to {:?}", path, dest_path);
                fs::copy(&path, &dest_path)?;
            } else {
                log::info!("Database file already exists, skipping: {:?}", dest_path);
            }
        }
    }

    Ok(())
}

pub fn show_dashboard(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        w.unminimize().unwrap();
        w.show().unwrap();
        w.set_focus().unwrap();
    }
}
