#[cfg(not(target_os = "macos"))]
use keyring::Entry;
#[cfg(not(target_os = "windows"))]
use std::process::Command;

#[cfg(target_os = "linux")]
use std::{io::Write, process::Stdio};

#[allow(dead_code)]
const KEYRING_SERVICE: &str = "onebox.oneoh.cloud";
#[allow(dead_code)]
const KEYRING_KEY_NAME: &str = "privilege_password";

// 定义 trait 作为接口
#[allow(dead_code)]
pub trait PrivilegeHelper {
    #[cfg(not(target_os = "windows"))]
    fn get_current_user() -> String {
        "unknown".to_string()
    }
    async fn is_privileged(_password: Option<String>) -> bool {
        // 默认实现
        false
    }
}

// 各平台实现
#[cfg(target_os = "windows")]
pub struct PlatformPrivilegeHelper;

#[cfg(target_os = "windows")]
impl PrivilegeHelper for PlatformPrivilegeHelper {
    async fn is_privileged(_password: Option<String>) -> bool {
        // 默认实现
        false
    }
}

#[cfg(target_os = "linux")]
pub struct PlatformPrivilegeHelper;

#[cfg(target_os = "linux")]
impl PrivilegeHelper for PlatformPrivilegeHelper {
    fn get_current_user() -> String {
        "root".to_string()
    }
    async fn is_privileged(password: Option<String>) -> bool {
        let password = match password {
            Some(p) => p,
            None => get_privilege_password_from_keyring().await,
        };
        let mut child = match Command::new("sudo")
            .arg("-S")
            .arg("whoami")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return false,
        };

        if let Some(mut stdin) = child.stdin.take() {
            if stdin
                .write_all(format!("{}\n", password).as_bytes())
                .is_err()
            {
                return false;
            }
        }

        let output = match child.wait_with_output() {
            Ok(output) => output,
            Err(_) => return false,
        };

        let stdout_str = String::from_utf8_lossy(&output.stdout);
        stdout_str.trim() == get_current_username()
    }
}

#[cfg(target_os = "macos")]
pub struct PlatformPrivilegeHelper;

#[cfg(target_os = "macos")]
impl PrivilegeHelper for PlatformPrivilegeHelper {
    fn get_current_user() -> String {
        let output = Command::new("whoami")
            .output()
            .expect("Failed to execute command");
        let username = String::from_utf8_lossy(&output.stdout);
        username.trim().to_string()
    }

    async fn is_privileged(_password: Option<String>) -> bool {
        // macOS: privileged helper replaces the password-based flow.
        // If the helper responds to ping, privilege is available.
        crate::helper_client::api::ping().is_ok()
    }
}

#[cfg(target_os = "linux")]
pub fn get_current_username() -> String {
    PlatformPrivilegeHelper::get_current_user()
}

#[cfg(target_os = "linux")]
pub async fn get_privilege_password_from_keyring() -> String {
    match Entry::new(KEYRING_SERVICE, KEYRING_KEY_NAME) {
        Ok(entry) => entry.get_password().unwrap_or_default(),
        Err(_) => String::new(),
    }
}

#[tauri::command]
pub async fn is_privileged(password: Option<String>) -> bool {
    PlatformPrivilegeHelper::is_privileged(password).await
}

#[tauri::command]
pub async fn save_privilege_password_to_keyring(password: String) -> bool {
    // macOS: privileged helper handles all root operations via XPC; no
    // password is stored in the keychain. Return true so the frontend
    // considers the "save" step successful without actually persisting.
    #[cfg(target_os = "macos")]
    {
        let _ = password;
        return true;
    }
    #[cfg(not(target_os = "macos"))]
    {
        match Entry::new(KEYRING_SERVICE, KEYRING_KEY_NAME) {
            Ok(entry) => entry.set_password(&password).is_ok(),
            Err(_) => false,
        }
    }
}
