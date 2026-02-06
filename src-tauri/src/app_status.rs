use std::sync::Mutex;

pub struct AppData {
    pub log_buffer: Mutex<Vec<String>>,
    pub error_log_buffer: Mutex<Vec<String>>,
}

pub enum LogType {
    Info,
    Error,
}

impl AppData {
    pub fn new() -> Self {
        Self {
            log_buffer: Mutex::new(Vec::new()),
            error_log_buffer: Mutex::new(Vec::new()),
        }
    }

    pub fn write(&self, log: String, log_type: LogType) {
        let buffer = match log_type {
            LogType::Info => &self.log_buffer,
            LogType::Error => &self.error_log_buffer,
        };

        if let Ok(mut buffer) = buffer.lock() {
            buffer.push(log);
            if buffer.len() > 10 {
                buffer.remove(0);
            }
        }
    }

    pub fn read(&self, log_type: LogType) -> String {
        let buffer = match log_type {
            LogType::Info => &self.log_buffer,
            LogType::Error => &self.error_log_buffer,
        };

        if let Ok(buffer) = buffer.lock() {
            buffer.join("\n")
        } else {
            String::new()
        }
    }

    pub fn read_cleared(&self, log_type: LogType) -> String {
        let buffer = match log_type {
            LogType::Info => &self.log_buffer,
            LogType::Error => &self.error_log_buffer,
        };

        if let Ok(mut buffer) = buffer.lock() {
            let logs = buffer.join("\n");
            buffer.clear();
            logs
        } else {
            String::new()
        }
    }
}
