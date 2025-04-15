use tauri::{AppHandle, Manager, Window, WindowEvent};
mod core;
mod database;
mod plugins;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
#[tauri::command]
fn get_app_version(app: AppHandle) -> String {
    let package_info = app.package_info();
    package_info.version.to_string() // 返回版本号，如 "1.0.0"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database::get_migrations();
    let builder = tauri::Builder::default().plugin(tauri_plugin_http::init());
    let builder = plugins::register_plugins(builder, migrations);
    builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            greet,
            core::version,
            core::start,
            core::stop,
            core::is_running
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .on_window_event(|window: &Window, event: &WindowEvent| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // 阻止窗口关闭
                api.prevent_close();
                print!("窗口关闭请求被重定向为最小化到托盘");
                // 隐藏窗口（最小化到托盘）
                if let Some(main_window) = window.app_handle().get_webview_window("main") {
                    main_window.hide().unwrap();
                }
            }
            WindowEvent::Destroyed => {
                let _ = core::stop();
                println!("Destroyed");
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
