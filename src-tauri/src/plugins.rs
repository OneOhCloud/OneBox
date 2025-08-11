use log::LevelFilter;
use tauri::{AppHandle, Builder, Manager, Wry};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::Migration;

pub fn register_plugins(builder: Builder<Wry>, migrations: Vec<Migration>) -> Builder<Wry> {
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:data.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(
            |app: &AppHandle, _args, _cwd| {
                let _ = show_window(app);
            },
        ))
        .plugin(tauri_plugin_opener::init())
}

fn show_window(app: &AppHandle) {
    let windows = app.webview_windows();

    windows
        .values()
        .next()
        .expect("Sorry, no window found")
        .set_focus()
        .expect("Can't Bring Window to Focus");
}
