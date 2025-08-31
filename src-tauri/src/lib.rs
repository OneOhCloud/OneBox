#[cfg(target_os = "windows")]
use png;
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_http::reqwest;
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
            privilege::is_privileged,
            privilege::save_privilege_password_to_keyring,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            log::info!("app log path: {:?}", app.path().app_log_dir());
            log::info!("app data path: {:?}", app.path().app_data_dir());
            log::info!("app cache path: {:?}", app.path().app_cache_dir());
            log::info!("app config path: {:?}", app.path().app_config_dir());
            log::info!("app local data path: {:?}", app.path().app_local_data_dir());

            tauri::async_runtime::spawn(async {
                match reqwest::get("http://captive.oneoh.cloud").await {
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
