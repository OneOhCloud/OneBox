//! Direct NSWindow.appearance override for macOS.
//!
//! Background: on Tauri 2.10 + macOS 26 (Tahoe), `window.setTheme('dark')`
//! from `@tauri-apps/api/window` silently no-ops the native title bar —
//! the JS promise resolves, no error is thrown, the <html data-theme> is
//! applied, but the NSWindow's appearance stays Aqua (light). Setting the
//! OS-level appearance to Dark in System Settings also has no effect on
//! this specific window (normally NSWindow.appearance=nil inherits from
//! the OS, but something in tao/wry pins the default to Aqua).
//!
//! Workaround: this command bypasses `set_theme` and talks to AppKit
//! directly via `src/macos_theme.m`. Main-thread dispatch + displayIfNeeded
//! forces AppKit to apply the new appearance on the next draw cycle.

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn onebox_set_window_appearance(ns_window_ptr: *mut std::ffi::c_void, theme: i32);
}

#[tauri::command]
pub fn set_native_window_theme(
    window: tauri::Window,
    theme: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        let mode: i32 = match theme.as_deref() {
            Some("light") => 1,
            Some("dark") => 2,
            _ => 0, // None or unknown — inherit from OS
        };
        unsafe {
            onebox_set_window_appearance(ns_window, mode);
        }
        log::debug!(
            "[theme] native set_window_appearance label={} mode={}",
            window.label(),
            mode
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        // No-op on non-mac hosts — Linux/Windows fall back to the JS-side
        // `window.setTheme()` which does work there.
        let _ = (window, theme);
    }
    Ok(())
}
