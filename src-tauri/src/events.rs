use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

/// Builder::on_menu_event 处理器
pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "show" => {
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                w.unminimize().unwrap();
                w.show().unwrap();
                w.set_focus().unwrap();
            }
        }
        "quit" => {
            crate::command::sync_quit(app.clone());
        }
        "enable" => {
            // 已在前端处理，此处略过
        }
        id => {
            log::warn!("menu item {:?} not handled", id);
        }
    }
}

/// Builder::on_window_event 处理器
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // 主窗口关闭请求重定向为隐藏到托盘
            if window.label() == "main" {
                api.prevent_close();
                log::info!("窗口关闭请求被重定向为最小化到托盘");
                if let Some(w) = window.app_handle().get_webview_window("main") {
                    w.hide().unwrap();
                }
            }
        }
        WindowEvent::Destroyed => {
            if window.label() == "main" {
                log::info!("主窗口被销毁，应用将退出");
                crate::command::sync_quit(window.app_handle().clone());
            }
            log::info!("Destroyed");
        }
        _ => {}
    }
}

/// App::run 事件处理器
pub fn on_run_event(app_handle: &AppHandle, event: RunEvent) {
    // macOS：访达点击已运行 App 图标时触发 Reopen，将隐藏的主窗口重新显示
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen {
        has_visible_windows,
        ..
    } = event
    {
        if !has_visible_windows {
            if let Some(w) = app_handle.get_webview_window("main") {
                w.show().unwrap_or_else(|e| {
                    log::error!("Failed to show main window on reopen: {}", e);
                });
                w.set_focus().unwrap_or_else(|e| {
                    log::error!("Failed to focus main window on reopen: {}", e);
                });
            }
        }
    }

    // 其他平台：静默忽略
    #[cfg(not(target_os = "macos"))]
    let _ = (app_handle, event);
}
