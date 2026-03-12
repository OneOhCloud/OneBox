use log::LevelFilter;
use tauri::{AppHandle, Builder, Manager, Wry};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::Migration;

#[allow(unused_variables)]
pub fn register_plugins(builder: Builder<Wry>, migrations: Vec<Migration>) -> Builder<Wry> {
    builder
        .plugin(tauri_plugin_single_instance::init(
            |app: &AppHandle, args, _cwd| {
                // On Windows, deep links arrive as CLI args to a new process.
                // single_instance kills that process and gives us its args here.
                // We must forward the URL manually so on_open_url fires.
                #[cfg(windows)]
                {
                    use tauri::Emitter;
                    if let Some(url_str) = args.iter().skip(1).find(|a| a.contains("://")) {
                        let _ = app.emit("deep-link://new-url", vec![url_str.as_str()]);
                    }
                }
                show_window(app);
            },
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin({
            let targets = ["oneoh_sing_box_lib", "tauri_plugin_deep_link"];
            tauri_plugin_log::Builder::new()
                .filter(move |metadata| {
                    targets
                        .iter()
                        .any(|&target| metadata.target().starts_with(target))
                })
                .level(LevelFilter::Info)
                .build()
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
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

    if let Some(main_window) = app.get_webview_window("main") {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            main_window.unminimize().unwrap();
        }
        main_window.show().unwrap();
        main_window.set_focus().unwrap();
    }
}
