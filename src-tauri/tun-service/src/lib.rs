#![cfg(target_os = "windows")]
#![allow(dead_code)]

pub mod dns;
pub mod scm;
pub mod service;

pub const SERVICE_NAME: &str = "OneBoxTunService";
pub const SERVICE_DISPLAY_NAME: &str = "OneBox TUN Service";
pub const SERVICE_DESCRIPTION: &str =
    "Runs sing-box in TUN mode on behalf of OneBox. Installed once per machine; started on demand without UAC.";
