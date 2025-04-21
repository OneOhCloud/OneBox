use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_http::reqwest;

mod core;
mod database;
mod plugins;
mod privilege;

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
async fn ping(url: String) -> bool {
    let client = reqwest::ClientBuilder::new()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .unwrap();

    match client.get(url).send().await {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database::get_migrations();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_stronghold::Builder::new(|pass| todo!()).build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init());
    let builder = plugins::register_plugins(builder, migrations);
    builder
        .invoke_handler(tauri::generate_handler![
            ping,
            get_app_version,
            open_devtools,
            core::version,
            core::start,
            core::stop,
            core::is_running,
            privilege::is_privileged,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

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
                let _ = core::stop(window.app_handle().clone());
                println!("Destroyed");
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
