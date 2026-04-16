/// Check whether platform-specific privilege escalation is available.
///
/// - macOS: true if the privileged helper responds to ping (installed via SMJobBless).
/// - Linux: true if `pkexec` is available (polkit-based escalation).
/// - Windows: always false (service-based model; no runtime privilege check needed).
#[tauri::command]
pub async fn is_privileged(_password: Option<String>) -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::engine::macos_helper::api::ping().is_ok()
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
