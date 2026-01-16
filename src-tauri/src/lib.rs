#[cfg(target_os = "windows")]
use png;
use std::fs;
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_http::reqwest;
mod app_status;
mod core;
mod database;
mod lan;
mod plugins;
mod privilege;
mod vpn;

#[tauri::command]
fn get_app_version(app: AppHandle) -> String {
    let package_info = app.package_info();
    package_info.version.to_string() // 返回版本号，如 "1.0.0"
}

#[tauri::command]
fn open_devtools(app: AppHandle) {
    let window = app.get_webview_window("main").unwrap();
    window.open_devtools();
}

#[tauri::command]
async fn quit(app: AppHandle) {
    // 退出应用并清理资源
    log::info!("Quitting application...");
    if let Err(e) = core::stop(app.clone()).await {
        log::error!("Failed to stop proxy: {}", e);
    } else {
        log::info!("Proxy stopped successfully.");
        log::info!("Application stopped successfully.");
        app.exit(0);
    }
}

fn sync_quit(app: AppHandle) {
    // 同步退出应用
    tauri::async_runtime::block_on(quit(app));
}

#[tauri::command]
fn get_tray_icon(app: AppHandle) -> Vec<u8> {
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
            let mut encoder = png::Encoder::new(&mut png_data, width as u32, height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(rgba).unwrap();
        }
        png_data
    }
}

#[tauri::command]
async fn create_window(app: tauri::AppHandle, label: String, window_tag: String, title: String) {
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

/// 复制 resources 目录下的 .db 文件到 appConfigDir
fn copy_database_files(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database::get_migrations();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init());
    let builder = plugins::register_plugins(builder, migrations);
    builder
        .invoke_handler(tauri::generate_handler![
            quit,
            open_devtools,
            create_window,
            get_app_version,
            get_tray_icon,
            lan::get_lan_ip,
            lan::ping_google,
            lan::open_browser,
            lan::get_captive_redirect_url,
            lan::check_captive_portal_status,
            core::stop,
            core::start,
            core::version,
            core::is_running,
            core::reload_config,
            app_status::read_logs,
            privilege::is_privileged,
            privilege::save_privilege_password_to_keyring,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            app.manage(app_status::AppData::new());
            log::info!("app log path: {:?}", app.path().app_log_dir());
            log::info!("app data path: {:?}", app.path().app_data_dir());
            log::info!("app cache path: {:?}", app.path().app_cache_dir());
            log::info!("app config path: {:?}", app.path().app_config_dir());
            log::info!("app local data path: {:?}", app.path().app_local_data_dir());

            // 复制 resources 目录下的 .db 文件到 appConfigDir
            if let Err(e) = copy_database_files(app.handle()) {
                log::error!("Failed to copy database files: {}", e);
            }

            let app_version = app.package_info().version.to_string();
            let os = tauri_plugin_os::platform();
            let arch = tauri_plugin_os::arch();
            let locale = tauri_plugin_os::locale().unwrap_or_else(|| String::from("en-US"));
            let os_info = format!("{}/{}", os, arch);
            let user_agent = format!("OneBox/{} (Tauri; {}; {})", app_version, os_info, locale);

            tauri::async_runtime::spawn(async move {
                log::info!("User-Agent: {}", user_agent);
                let client = reqwest::Client::new();
                match client
                    .get("https://captive.oneoh.cloud")
                    .header("User-Agent", user_agent)
                    .send()
                    .await
                {
                    Ok(resp) => {
                        log::info!("captive.oneoh.cloud status: {}", resp.status());
                    }
                    Err(e) => {
                        log::error!("captive.oneoh.cloud request error: {}", e);
                    }
                }
            });

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(main_window) = app.get_webview_window("main") {
                    main_window.show().unwrap();
                    main_window.set_focus().unwrap();
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                // 显示窗口
                if let Some(main_window) = app.get_webview_window("main") {
                    #[cfg(any(target_os = "windows", target_os = "linux"))]
                    {
                        main_window.unminimize().unwrap();
                    }
                    main_window.show().unwrap();
                    main_window.set_focus().unwrap();
                }
            }
            "quit" => {
                sync_quit(app.clone());
            }

            "enable" => {
                // 已在前端处理，此处略过或者未来添加其他逻辑
            }
            _ => {
                log::warn!("menu item {:?} not handled", event.id);
            }
        })
        .on_window_event(|window: &Window, event: &WindowEvent| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // 阻止窗口关闭
                // 只针对 main 窗口
                if window.label() == "main" {
                    api.prevent_close();
                    log::info!("窗口关闭请求被重定向为最小化到托盘");
                    // 隐藏窗口（最小化到托盘）
                    if let Some(main_window) = window.app_handle().get_webview_window("main") {
                        main_window.hide().unwrap();
                    }
                }
            }
            WindowEvent::Destroyed => {
                // 只针对 main 窗口
                if window.label() == "main" {
                    log::info!("主窗口被销毁，应用将退出");
                    let app_clone = window.app_handle().clone();
                    sync_quit(app_clone);
                }

                log::info!("Destroyed");
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
