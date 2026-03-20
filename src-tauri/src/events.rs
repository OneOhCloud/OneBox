use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use crate::utils::show_dashboard;

/// Builder::on_menu_event 处理器
pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "show" => {
            show_dashboard(app.clone());
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
    match event {
        // macOS：访达点击已运行 App 图标时触发 Reopen，将隐藏的主窗口重新显示
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
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
        // Tauri/WRY 已完成 delegate 安装，此时再安装 SentinelDelegate
        // 可以确保 applicationShouldTerminate: 能正确拦截关机事件。
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        RunEvent::Ready => {
            crate::setup::spawn_lifecycle_listener(app_handle);
        }
        // 进程退出前的最后清理点（belt-and-suspenders）。
        // 无论何种退出路径（用户退出、系统关机、SIGTERM），RunEvent::Exit
        // 都会在事件循环结束时触发。此处同步清理系统代理，确保即使
        // applicationShouldTerminate: 未被调用或 lifecycle shutdown handler
        // 执行失败，代理也能被可靠清除。
        RunEvent::Exit => {
            use crate::vpn::unset_proxy_on_shutdown;
            log::info!("[exit] RunEvent::Exit fired, performing final proxy cleanup");
            unset_proxy_on_shutdown();
        }
        _ => {
            #[cfg(not(target_os = "macos"))]
            let _ = app_handle;
        }
    }
}
