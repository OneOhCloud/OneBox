use crate::{
    core::stop,
    state::{AppData, LogType},
};

use tauri::AppHandle;
use tauri::Manager;

use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub fn get_tray_icon(app: AppHandle) -> Vec<u8> {
    #[cfg(target_os = "macos")]
    {
        log::info!("macos tray icon for app: {:?}", app.package_info().name);
        include_bytes!("../icons/macos.png").to_vec()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let icon = app.default_window_icon().unwrap();
        let rgba = icon.rgba();
        let width = icon.width();
        let height = icon.height();
        // 将 RGBA 数据转换为 PNG 格式
        let mut png_data = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_data, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(rgba).unwrap();
        }
        png_data
    }
}

#[tauri::command]
pub fn open_directory(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn create_window(
    app: tauri::AppHandle,
    label: String,
    window_tag: String,
    title: String,
) {
    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_webview_window(&label) {
        // 如果窗口已存在，则切换到该窗口
        existing_window.show().unwrap_or_else(|e| {
            log::error!("Failed to show existing window: {}", e);
        });
        existing_window.set_focus().unwrap_or_else(|e| {
            log::error!("Failed to focus existing window: {}", e);
        });
        existing_window.unminimize().unwrap_or_else(|e| {
            log::error!("Failed to unminimize existing window: {}", e);
        });
        return;
    }

    // 如果窗口不存在，则创建新窗口
    let _webview_window = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?windowTag={}", window_tag).into()),
    )
    .title(title)
    .inner_size(800.0, 600.0) // 设置窗口大小，宽度800，高度600
    .resizable(true) // 允许用户调整窗口大小
    .build()
    .map_err(|e| {
        log::error!("Failed to create window: {}", e);
    });
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    let package_info = app.package_info();
    package_info.version.to_string() // 返回版本号，如 "1.0.0"
}

#[tauri::command]
pub fn get_app_paths(app: AppHandle) -> Result<serde_json::Value, String> {
    let paths = serde_json::json!({
        "log_dir": app.path().app_log_dir().map_err(|e| e.to_string())?,
        "data_dir": app.path().app_data_dir().map_err(|e| e.to_string())?,
        "cache_dir": app.path().app_cache_dir().map_err(|e| e.to_string())?,
        "config_dir": app.path().app_config_dir().map_err(|e| e.to_string())?,
        "local_data_dir": app.path().app_local_data_dir().map_err(|e| e.to_string())?,
    });
    Ok(paths)
}

#[tauri::command]
pub fn open_devtools(app: AppHandle) {
    let window = app.get_webview_window("main").unwrap();
    window.open_devtools();
}

#[tauri::command]
async fn quit(app: AppHandle) {
    // 退出应用并清理资源
    log::info!("Quitting application...");
    if let Err(e) = stop(app.clone()).await {
        log::error!("Failed to stop proxy: {}", e);
    } else {
        log::info!("Proxy stopped successfully.");
        log::info!("Application stopped successfully.");
        app.exit(0);
    }
}

pub fn sync_quit(app: AppHandle) {
    // 同步退出应用
    tauri::async_runtime::block_on(quit(app));
}

#[tauri::command]
pub fn read_logs(app_data: tauri::State<AppData>, is_error: bool) -> String {
    let log_type = if is_error {
        LogType::Error
    } else {
        LogType::Info
    };
    app_data.read_cleared(log_type)
}

#[tauri::command]
pub async fn version(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
    let output = sidecar_command
        .arg("version")
        .output()
        .await
        .map_err(|e| e.to_string())?;
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}
