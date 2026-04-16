/// Check whether platform-specific privilege escalation is available.
///
/// - macOS: true if the privileged helper responds to ping (installed via SMJobBless).
/// - Linux: true if `pkexec` is available (polkit-based escalation).
/// - Windows: always false (service-based model; no runtime privilege check needed).
#[tauri::command]
pub async fn is_privileged(_password: Option<String>) -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::helper_client::api::ping().is_ok()
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        Command::new("which")
            .arg("pkexec")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        false
    }
}

/// Legacy command kept for frontend compatibility. Password is no longer
/// stored on any platform — all privilege escalation is handled by the
/// platform's native mechanism (helper, pkexec, or service).
#[tauri::command]
pub async fn save_privilege_password_to_keyring(_password: String) -> bool {
    true
}
