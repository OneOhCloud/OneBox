use std::path::Path;

use tauri::utils::platform;

/// 获取 sidecar 路径
pub fn get_sidecar_path(program: &Path) -> Result<String, anyhow::Error> {
    match platform::current_exe()?.parent() {
        #[cfg(windows)]
        Some(exe_dir) => Ok(exe_dir
            .join(program)
            .with_extension("exe")
            .to_string_lossy()
            .into_owned()),
        #[cfg(not(windows))]
        Some(exe_dir) => Ok(exe_dir.join(program).to_string_lossy().into_owned()),
        None => Err(anyhow::anyhow!("Failed to get the executable directory")),
    }
}
