use std::process::Command;
use tauri::command;

// 定义 trait 作为接口
pub trait PrivilegeHelper {
    fn get_current_user() -> String;
    fn is_privileged(username: String, password: String) -> bool {
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
        panic!("Windows platform is not supported yet");
    }

    fn is_privileged(username: String, password: String) -> bool {
        panic!("Windows platform is not supported yet");
    }
}

#[cfg(target_os = "linux")]
pub struct PlatformPrivilegeHelper;

#[cfg(target_os = "linux")]
impl PrivilegeHelper for PlatformPrivilegeHelper {
    fn get_current_user() -> String {
        let output = Command::new("whoami")
            .output()
            .expect("Failed to execute command");
        let username = String::from_utf8_lossy(&output.stdout);
        username.trim().to_string()
    }
    fn is_privileged(username: String, password: String) -> bool {
        // 这里可以实现 Linux 上的权限验证逻辑
        // 例如使用 sudo 命令来验证用户是否有权限
        panic!("Linux platform is not supported yet");
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

    fn is_privileged(username: String, password: String) -> bool {
        let output = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "do shell script \"exit 0\" user name \"{}\" password \"{}\" with administrator privileges",
                username, password
            ))
            .output()
            .expect("Failed to execute command");
        if output.status.success() {
            return true;
        } else {
            let error_message = String::from_utf8_lossy(&output.stderr);
            println!("Error: {}", error_message);
            return false;
        }
    }
}

// 对外只暴露统一接口
pub fn get_current_user() -> String {
    PlatformPrivilegeHelper::get_current_user()
}

#[tauri::command]
pub fn is_privileged(username: String, password: String) -> bool {
    PlatformPrivilegeHelper::is_privileged(username, password)
}
