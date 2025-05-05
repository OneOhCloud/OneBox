use tokio::process::Command;

#[tauri::command]
pub async fn get_lan_ip() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .arg("-Command")
            .arg("Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -First 1")
            .output()
            .await
            .map_err(|e| e.to_string())?;
        
        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        
        if ip.is_empty() {
            // 备用方案：如果 PowerShell 命令未能获取到 IP，使用改进的 CMD 命令
            let fallback_output = Command::new("cmd")
                .arg("/c")
                .arg("ipconfig | findstr /i \"IPv4\" | findstr /v \"127.0.0.1\" | findstr /v \"169.254.\" | for /f \"tokens=2 delims=:\" %i in ('more') do @echo %i")
                .output()
                .await
                .map_err(|e| e.to_string())?;
            
            let fallback_ip = String::from_utf8_lossy(&fallback_output.stdout);
            let first_valid_ip = fallback_ip.lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .next()
                .unwrap_or("").to_string();
            
            Ok(first_valid_ip)
        } else {
            Ok(ip)
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("bash")
            .arg("-c")
            .arg("ip -4 addr show | awk '/inet /{print $2}' | cut -d/ -f1 | grep -v '^127\\.' | head -n 1")
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let ip = String::from_utf8_lossy(&output.stdout);
        Ok(ip.trim().to_string())
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("bash")
            .arg("-c")
            .arg("ifconfig | grep 'flags=' | cut -d: -f1 | xargs -I {} ipconfig getifaddr {} 2>/dev/null")
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let ip = String::from_utf8_lossy(&output.stdout);
        Ok(ip.trim().to_string())
    }
}
