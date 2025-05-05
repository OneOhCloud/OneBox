use std::process::Command;

#[tauri::command]
pub fn get_lan_ip() -> String {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .arg("-Command")
            .arg("(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress")
            .output()
            .expect("Failed to execute command");
        let ip = String::from_utf8_lossy(&output.stdout);
        ip.trim().to_string()
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("bash")
            .arg("-c")
            .arg("ip -4 addr show | awk '/inet /{print $2}' | cut -d/ -f1 | grep -v '^127\\.' | head -n 1")
            .output()
            .expect("Failed to execute command");
        let ip = String::from_utf8_lossy(&output.stdout);
        ip.trim().to_string()
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("bash")
            .arg("-c")
            .arg("ifconfig | grep 'flags=' | cut -d: -f1 | xargs -I {} ipconfig getifaddr {} 2>/dev/null")
            .output()
            .expect("Failed to execute command");
        let ip = String::from_utf8_lossy(&output.stdout);
        ip.trim().to_string()
    }
}
