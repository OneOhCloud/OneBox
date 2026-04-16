mod command;
mod core;
mod database;
mod events;
mod helper_client;
mod lan;
mod plugins;
mod privilege;
mod setup;
mod state;
mod utils;
pub mod vpn;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows 提权 helper 分支:父进程通过 ShellExecuteExW runas 用同一 exe
    // 带 `--onebox-tun-helper <sub> [args...]` 重启自己;elevated 子进程在
    // 这里直接进入 helper 逻辑执行 DNS 覆写 / 启停 sing-box,完成后 exit,
    // 不会进入 tauri::Builder 初始化,避免弹第二个 GUI 窗口。
    #[cfg(target_os = "windows")]
    {
        let raw_args: Vec<String> = std::env::args().collect();
        if let Some(pos) = raw_args.iter().position(|a| a == "--onebox-tun-helper") {
            let helper_args: Vec<String> = raw_args[pos + 1..].to_vec();
            let code = vpn::windows_native::run_helper(&helper_args);
            std::process::exit(code);
        }
    }

    let migrations = database::get_migrations();
    let builder = tauri::Builder::default();

    plugins::register_plugins(builder, migrations)
        .invoke_handler(tauri::generate_handler![
            lan::get_lan_ip,
            lan::ping_google,
            lan::open_browser,
            lan::get_captive_redirect_url,
            lan::check_captive_portal_status,
            lan::get_optimal_local_dns_server,
            lan::fetch_config_with_optimal_dns,
            core::stop,
            core::start,
            core::is_running,
            core::get_vpn_state,
            core::clear_vpn_error,
            core::reload_config,
            command::version,
            command::read_logs,
            command::open_devtools,
            command::get_app_paths,
            command::get_tray_icon,
            command::create_window,
            command::open_directory,
            command::get_app_version,
            command::get_pending_deep_link,
            privilege::is_privileged,
            privilege::save_privilege_password_to_keyring,
            helper_client::helper_ping,
            helper_client::helper_install,
            helper_client::helper_smoke_test,
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
