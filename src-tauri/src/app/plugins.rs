use log::LevelFilter;
use tauri::{AppHandle, Builder, Manager, Wry};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_sql::Migration;

// OneBox.log rotation policy — rotate when the active file exceeds 50 MB,
// keep all rotated files (renamed to OneBox_YYYY-MM-DD_HH-MM-SS.log). A
// startup sweep in `core::log::cleanup_old_onebox_logs` deletes rotated
// files older than 7 days. Uncompressed — triage speed trumps disk cost.
const ONEBOX_LOG_MAX_FILE_SIZE: u128 = 50 * 1024 * 1024;

#[allow(unused_variables)]
pub fn register_plugins(builder: Builder<Wry>, migrations: Vec<Migration>) -> Builder<Wry> {
    builder
        .plugin(tauri_plugin_single_instance::init(
            |app: &AppHandle, args, _cwd| {
                // On Windows and Linux, deep links arrive as CLI args to a new
                // process. single_instance kills that process and gives us its
                // args here. We must forward the URL manually so on_open_url fires.
                #[cfg(any(windows, target_os = "linux"))]
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
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(ONEBOX_LOG_MAX_FILE_SIZE)
                .rotation_strategy(RotationStrategy::KeepAll)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
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
        // The login item carries `--silent`; `app::setup::should_start_hidden`
        // reads it back to leave the window hidden on an autostart launch.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
}

// A second launch means the user asked for the app, so surface the window even
// if the first launch was a silent autostart. Every call is best-effort: the
// window can legitimately be hidden or already gone, and neither is worth
// aborting the running instance for.
fn show_window(app: &AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        let _ = main_window.unminimize();
        let _ = main_window.show();
        let _ = main_window.set_focus();
        // This is the only way back to the UI after a silent autostart, so
        // record whether it actually landed.
        log::info!(
            "[startup] second instance -> window visible={:?}",
            main_window.is_visible()
        );
    } else if let Some(window) = app.webview_windows().values().next() {
        let _ = window.set_focus();
        log::warn!("[startup] second instance -> no main window, focused a fallback");
    }
}
