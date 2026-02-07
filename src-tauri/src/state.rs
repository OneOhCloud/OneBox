use std::sync::Mutex;

pub struct AppData {
    pub cached_dns: Mutex<Option<String>>,
    pub log_buffer: Mutex<Vec<String>>,
    pub error_log_buffer: Mutex<Vec<String>>,
    pub clash_secret: Mutex<Option<String>>,
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
            cached_dns: Mutex::new(None),
            clash_secret: Mutex::new(None),
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

    #[allow(dead_code)]
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

    pub fn get_cached_dns(&self) -> Option<String> {
        if let Ok(cache) = self.cached_dns.lock() {
            cache.clone()
        } else {
            None
        }
    }

    pub fn set_cached_dns(&self, dns: Option<String>) {
        if let Ok(mut cache) = self.cached_dns.lock() {
            *cache = dns;
        }
    }

    pub fn get_clash_secret(&self) -> Option<String> {
        if let Ok(secret) = self.clash_secret.lock() {
            secret.clone()
        } else {
            None
        }
    }
    pub fn set_clash_secret(&self, secret: Option<String>) {
        if let Ok(mut sec) = self.clash_secret.lock() {
            *sec = secret;
        }
    }
}
