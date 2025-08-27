use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// 特权控制器命令
#[derive(Serialize, Deserialize, Debug)]
pub enum PrivilegeCommand {
    Start {
        sing_box_path: String,
        config_path: String,
    },
    Stop,
    Status,
    Shutdown,
}

/// 特权控制器响应
#[derive(Serialize, Deserialize, Debug)]
pub enum PrivilegeResponse {
    Success,
    Error { message: String },
    Status { running: bool },
}

/// 特权控制器服务
pub struct PrivilegeController {
    port: u16,
    process: Arc<Mutex<Option<Child>>>,
    running: Arc<Mutex<bool>>,
}

impl PrivilegeController {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            process: Arc::new(Mutex::new(None)),
            running: Arc::new(Mutex::new(false)),
        }
    }

    /// 启动特权控制器服务
    pub fn start_server(&self) -> Result<()> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", self.port))?;
        println!("Privilege controller listening on port {}", self.port);

        let process = Arc::clone(&self.process);
        let running = Arc::clone(&self.running);

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let process = Arc::clone(&process);
                    let running = Arc::clone(&running);

                    thread::spawn(move || {
                        if let Err(e) = Self::handle_client(stream, process, running) {
                            println!("Error handling client: {}", e);
                        }
                    });
                }
                Err(e) => {
                    println!("Error accepting connection: {}", e);
                }
            }
        }

        Ok(())
    }

    /// 处理客户端连接
    fn handle_client(
        mut stream: TcpStream,
        process: Arc<Mutex<Option<Child>>>,
        running: Arc<Mutex<bool>>,
    ) -> Result<()> {
        let mut buffer = [0; 1024];
        let bytes_read = stream.read(&mut buffer)?;
        let command_str = String::from_utf8_lossy(&buffer[..bytes_read]);

        let command: PrivilegeCommand = serde_json::from_str(&command_str)?;
        println!("Received command: {:?}", command);

        let response = match command {
            PrivilegeCommand::Start {
                sing_box_path,
                config_path,
            } => Self::start_sing_box(&process, &running, &sing_box_path, &config_path),
            PrivilegeCommand::Stop => Self::stop_sing_box(&process, &running),
            PrivilegeCommand::Status => {
                let is_running = *running.lock().unwrap();
                PrivilegeResponse::Status {
                    running: is_running,
                }
            }
            PrivilegeCommand::Shutdown => {
                Self::stop_sing_box(&process, &running);
                std::process::exit(0);
            }
        };

        let response_str = serde_json::to_string(&response)?;
        stream.write_all(response_str.as_bytes())?;
        stream.flush()?;

        Ok(())
    }

    /// 启动sing-box进程
    fn start_sing_box(
        process: &Arc<Mutex<Option<Child>>>,
        running: &Arc<Mutex<bool>>,
        sing_box_path: &str,
        config_path: &str,
    ) -> PrivilegeResponse {
        // 首先停止已有进程
        Self::stop_sing_box(process, running);

        match Command::new(sing_box_path)
            .args(["run", "-c", config_path, "--disable-color"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => {
                *process.lock().unwrap() = Some(child);
                *running.lock().unwrap() = true;
                println!("Started sing-box with config: {}", config_path);
                PrivilegeResponse::Success
            }
            Err(e) => {
                println!("Failed to start sing-box: {}", e);
                PrivilegeResponse::Error {
                    message: format!("Failed to start sing-box: {}", e),
                }
            }
        }
    }

    /// 停止sing-box进程
    fn stop_sing_box(
        process: &Arc<Mutex<Option<Child>>>,
        running: &Arc<Mutex<bool>>,
    ) -> PrivilegeResponse {
        let mut process_guard = process.lock().unwrap();
        let mut running_guard = running.lock().unwrap();

        if let Some(mut child) = process_guard.take() {
            match child.kill() {
                Ok(_) => {
                    // 等待进程退出
                    let _ = child.wait();
                    *running_guard = false;
                    println!("Stopped sing-box process");
                    PrivilegeResponse::Success
                }
                Err(e) => {
                    println!("Failed to stop sing-box: {}", e);
                    PrivilegeResponse::Error {
                        message: format!("Failed to stop sing-box: {}", e),
                    }
                }
            }
        } else {
            *running_guard = false;
            PrivilegeResponse::Success
        }
    }
}

/// 特权控制器客户端
pub struct PrivilegeControllerClient {
    port: u16,
}

impl PrivilegeControllerClient {
    pub fn new(port: u16) -> Self {
        Self { port }
    }

    /// 发送命令到特权控制器
    pub fn send_command(&self, command: PrivilegeCommand) -> Result<PrivilegeResponse> {
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", self.port))?;

        let command_str = serde_json::to_string(&command)?;
        stream.write_all(command_str.as_bytes())?;
        stream.flush()?;

        let mut buffer = [0; 1024];
        let bytes_read = stream.read(&mut buffer)?;
        let response_str = String::from_utf8_lossy(&buffer[..bytes_read]);

        let response: PrivilegeResponse = serde_json::from_str(&response_str)?;
        Ok(response)
    }

    /// 检查控制器是否运行
    pub fn is_controller_running(&self) -> bool {
        match TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", self.port).parse().unwrap(),
            Duration::from_millis(100),
        ) {
            Ok(_) => true,
            Err(_) => false,
        }
    }

    /// 启动sing-box
    pub fn start_sing_box(&self, sing_box_path: &str, config_path: &str) -> Result<()> {
        let command = PrivilegeCommand::Start {
            sing_box_path: sing_box_path.to_string(),
            config_path: config_path.to_string(),
        };

        match self.send_command(command)? {
            PrivilegeResponse::Success => Ok(()),
            PrivilegeResponse::Error { message } => Err(anyhow::anyhow!(message)),
            _ => Err(anyhow::anyhow!("Unexpected response")),
        }
    }

    /// 停止sing-box
    pub fn stop_sing_box(&self) -> Result<()> {
        let command = PrivilegeCommand::Stop;

        match self.send_command(command)? {
            PrivilegeResponse::Success => Ok(()),
            PrivilegeResponse::Error { message } => Err(anyhow::anyhow!(message)),
            _ => Err(anyhow::anyhow!("Unexpected response")),
        }
    }

    /// 获取sing-box状态
    pub fn get_status(&self) -> Result<bool> {
        let command = PrivilegeCommand::Status;

        match self.send_command(command)? {
            PrivilegeResponse::Status { running } => Ok(running),
            PrivilegeResponse::Error { message } => Err(anyhow::anyhow!(message)),
            _ => Err(anyhow::anyhow!("Unexpected response")),
        }
    }

    /// 关闭控制器
    pub fn shutdown_controller(&self) -> Result<()> {
        let command = PrivilegeCommand::Shutdown;
        let _ = self.send_command(command); // 忽略可能的连接错误，因为服务器会退出
        Ok(())
    }
}

/// 主函数 - 用于独立运行特权控制器
pub fn main() -> Result<()> {
    env_logger::init();

    let args: Vec<String> = std::env::args().collect();
    let port = if args.len() > 1 {
        args[1].parse().unwrap_or(18888)
    } else {
        18888
    };

    println!("Starting privilege controller on port {}", port);
    let controller = PrivilegeController::new(port);
    controller.start_server()
}
