use tauri::{AppHandle, Manager, Window, WindowEvent};
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
    core::reset_system_proxy(&app).await.unwrap_or_else(|e| {
        eprintln!("Failed to reset system proxy: {}", e);
    });
    app.exit(0);
}

#[tauri::command]
async fn create_window(app: tauri::AppHandle, label: String, window_tag: String, title: String) {
    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_webview_window(&label) {
        // 如果窗口已存在，则切换到该窗口
        existing_window.show().unwrap_or_else(|e| {
            eprintln!("Failed to show existing window: {}", e);
        });
        existing_window.set_focus().unwrap_or_else(|e| {
            eprintln!("Failed to focus existing window: {}", e);
        });
        existing_window.unminimize().unwrap_or_else(|e| {
            eprintln!("Failed to unminimize existing window: {}", e);
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
        eprintln!("Failed to create window: {}", e);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database::get_migrations();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init());
    let builder = plugins::register_plugins(builder, migrations);
    builder
        .invoke_handler(tauri::generate_handler![
            quit,
            open_devtools,
            create_window,
            get_app_version,
            lan::get_lan_ip,
            lan::ping_google,
            lan::open_browser,
            lan::ping_apple_captive,
            core::stop,
            core::start,
            core::version,
            core::is_running,
            privilege::is_privileged,
            privilege::save_privilege_password_to_keyring,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            println!("app log path: {:?}", app.path().app_log_dir());
            println!("app data path: {:?}", app.path().app_data_dir());
            println!("app cache path: {:?}", app.path().app_cache_dir());
            println!("app config path: {:?}", app.path().app_config_dir());
            println!("app local data path: {:?}", app.path().app_local_data_dir());

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
            _ => {
                println!("menu item {:?} not handled", event.id);
            }
        })
        .on_window_event(|window: &Window, event: &WindowEvent| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // 阻止窗口关闭
                // 只针对 main 窗口
                if window.label() != "main" {
                    return;
                }

                api.prevent_close();
                println!("窗口关闭请求被重定向为最小化到托盘");
                // 隐藏窗口（最小化到托盘）
                if let Some(main_window) = window.app_handle().get_webview_window("main") {
                    main_window.hide().unwrap();
                }
            }
            WindowEvent::Resized { .. } => {
                // 窗口大小改变
                println!("窗口大小改变");
            }
            WindowEvent::Destroyed => {
                let _ = core::stop(window.app_handle().clone());
                println!("Destroyed");
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
