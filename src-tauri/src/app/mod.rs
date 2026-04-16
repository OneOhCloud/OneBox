//! Tauri application shell: everything that wires the app to Tauri's
//! lifecycle / plugin system. None of these modules contains business
//! logic — they are the glue between the `tauri::Builder` and the rest
//! of the codebase (`core`, `engine`, `commands`).

pub mod database;
pub mod events;
pub mod plugins;
pub mod setup;
pub mod state;
