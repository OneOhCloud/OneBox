use std::fs;
use tauri::{AppHandle, Manager};

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
