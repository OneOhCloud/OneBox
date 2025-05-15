#[cfg(not(target_os = "windows"))]
use std::process::Command;

#[cfg(target_os = "linux")]
use std::{io::Write, process::Stdio};

// 定义 trait 作为接口
pub trait PrivilegeHelper {
    fn get_current_user() -> String {
        "unknown".to_string()
    }
    async fn is_privileged(_username: String, _password: String) -> bool {
        // 默认实现
        false
    }
}

// 各平台实现
#[cfg(target_os = "windows")]
pub struct PlatformPrivilegeHelper;

#[cfg(target_os = "windows")]
impl PrivilegeHelper for PlatformPrivilegeHelper {
    fn get_current_user() -> String {
        "".to_string()
    }

    async fn is_privileged(_username: String, _password: String) -> bool {
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
    async fn is_privileged(_username: String, password: String) -> bool {
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
        stdout_str.trim() == "root"
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

    async fn is_privileged(username: String, password: String) -> bool {
        let output = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "do shell script \"exit 0\" user name \"{}\" password \"{}\" with administrator privileges",
                username, password
            ))
            .output(); // 使用 .await 以异步方式等待命令完成

        match output {
            Ok(output) if output.status.success() => true,
            Ok(output) => {
                let error_message = String::from_utf8_lossy(&output.stderr);
                println!("Error: {}", error_message);
                false
            }
            Err(e) => {
                println!("Failed to execute command: {}", e);
                false
            }
        }
    }
}

#[tauri::command]
pub fn get_current_username() -> String {
    PlatformPrivilegeHelper::get_current_user()
}

#[tauri::command]
pub async fn is_privileged(username: String, password: String) -> bool {
    PlatformPrivilegeHelper::is_privileged(username, password).await
}
