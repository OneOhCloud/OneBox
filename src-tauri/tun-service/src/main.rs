#[cfg(target_os = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("install") => {
            let bundled = args.get(2).cloned().unwrap_or_else(|| {
                std::env::current_exe()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
            match tun_service::scm::ensure_installed(std::path::Path::new(&bundled)) {
                Ok(()) => std::process::exit(0),
                Err(e) => {
                    eprintln!("install failed: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Some("uninstall") => match tun_service::scm::uninstall() {
            Ok(()) => std::process::exit(0),
            Err(e) => {
                eprintln!("uninstall failed: {}", e);
                std::process::exit(1);
            }
        },
        _ => {
            let code = tun_service::service::run_dispatcher();
            std::process::exit(code);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn main() {}
