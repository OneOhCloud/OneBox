use lazy_static::lazy_static;
use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct ProcessManager {
    child: Option<CommandChild>,
}

lazy_static! {
    static ref PROCESS_MANAGER: Mutex<ProcessManager> = Mutex::new(ProcessManager { child: None });
}

#[tauri::command]
pub async fn version(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
    let output = sidecar_command
        .arg("version")
        .output()
        .await
        .map_err(|e| e.to_string())?;
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop() -> Result<(), String> {
    let mut manager = PROCESS_MANAGER.lock().unwrap();
    if let Some(child) = manager.child.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // 先停止现有进程
    let _ = stop().await;

    let sidecar_command = app
        .shell()
        .sidecar("sing-box")
        .map_err(|e| e.to_string())?;
    
    let (mut rx, child) = sidecar_command
        .args(["run", "-c", &path])
        .spawn()
        .map_err(|e| e.to_string())?;

    // 保存新的进程句柄
    PROCESS_MANAGER.lock().unwrap().child = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    println!("stdout: {line_str}");
                    app.emit("core_backend", Some(format!("'{line_str}'")))
                        .expect("failed to emit event");
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    println!("stderr: {line_str}");
                    app.emit("core_backend", Some(format!("'{line_str}'")))
                        .expect("failed to emit event");
                }
                CommandEvent::Terminated(status) => {
                    println!("Process terminated with status: {:?}", status);
                    app.emit(
                        "core_backend",
                        Some("Process terminated".to_string()),
                    )
                    .expect("failed to emit event");
                    // 清理进程管理器
                    PROCESS_MANAGER.lock().unwrap().child = None;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn is_running() -> bool {
    let manager = PROCESS_MANAGER.lock().unwrap();
    manager.child.is_some()
}