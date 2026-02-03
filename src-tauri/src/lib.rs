use tauri::{Manager, Window, WindowEvent};
use tauri_plugin_http::reqwest;
mod app_status;
mod command;
mod core;
mod database;
mod lan;
mod plugins;
mod privilege;
mod utils;
mod vpn;

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
            lan::get_lan_ip,
            lan::ping_google,
            lan::open_browser,
            lan::get_captive_redirect_url,
            lan::check_captive_portal_status,
            lan::get_optimal_dns_server,
            core::stop,
            core::start,
            core::is_running,
            core::reload_config,
            command::version,
            command::read_logs,
            command::open_devtools,
            command::get_app_paths,
            command::get_tray_icon,
            command::create_window,
            command::open_directory,
            command::get_app_version,
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

            // 复制 resources 目录下的 .db 文件到 appConfigDir
            if let Err(e) = utils::copy_database_files(app.handle()) {
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
                command::sync_quit(app.clone());
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
                    command::sync_quit(app_clone);
                }

                log::info!("Destroyed");
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
