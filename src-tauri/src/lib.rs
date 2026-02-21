mod command;
mod core;
mod database;
mod events;
mod lan;
mod plugins;
mod privilege;
mod setup;
mod state;
mod utils;
mod vpn;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database::get_migrations();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init());

    plugins::register_plugins(builder, migrations)
        .invoke_handler(tauri::generate_handler![
            lan::get_lan_ip,
            lan::ping_google,
            lan::open_browser,
            lan::get_captive_redirect_url,
            lan::check_captive_portal_status,
            lan::get_optimal_local_dns_server,
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
        .setup(setup::app_setup)
        .on_menu_event(events::on_menu_event)
        .on_window_event(events::on_window_event)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(events::on_run_event)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_valid_ipv4(addr: &str) -> bool {
        let segments: Vec<&str> = addr.split('.').collect();
        if segments.len() != 4 {
            return false;
        }
        for segment in segments {
            match segment.parse::<u8>() {
                Ok(_) => continue,
                Err(_) => return false,
            }
        }
        true
    }

    #[test]
    fn test_get_optimal_dns_server() {
        tauri::async_runtime::block_on(async {
            let res = lan::get_best_dns_server().await;
            assert!(res.is_some());
            let dns = res.unwrap();
            assert!(is_valid_ipv4(&dns));
        });
    }
}
