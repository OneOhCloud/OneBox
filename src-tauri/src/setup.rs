use tauri::Manager;
use tauri_plugin_http::reqwest;

/// App 初始化逻辑，对应 Builder::setup 闭包
pub fn app_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    {
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().build())?;
    }

    app.manage(crate::state::AppData::new());

    // 复制 resources 目录下的 .db 文件到 appConfigDir
    if let Err(e) = crate::utils::copy_database_files(app.handle()) {
        log::error!("Failed to copy database files: {}", e);
    }

    // 上报 User-Agent 至存活检测端点
    let app_version = app.package_info().version.to_string();
    let os = tauri_plugin_os::platform();
    let arch = tauri_plugin_os::arch();
    let locale = tauri_plugin_os::locale().unwrap_or_else(|| String::from("en-US"));
    let user_agent = format!(
        "OneBox/{} (Tauri; {}/{}; {})",
        app_version, os, arch, locale
    );

    tauri::async_runtime::spawn(async move {
        log::info!("User-Agent: {}", user_agent);
        let client = reqwest::Client::new();
        match client
            .get("https://captive.oneoh.cloud")
            .header("User-Agent", user_agent)
            .send()
            .await
        {
            Ok(resp) => log::info!("captive.oneoh.cloud status: {}", resp.status()),
            Err(e) => log::error!("captive.oneoh.cloud request error: {}", e),
        }
    });

    // macOS：以无 Dock 图标的附件模式运行，启动时直接显示主窗口
    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        if let Some(w) = app.get_webview_window("main") {
            w.show().unwrap();
            w.set_focus().unwrap();
        }
    }

    Ok(())
}
