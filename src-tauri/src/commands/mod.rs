//! Tauri command handlers — the UI-facing surface.
//!
//! Each submodule groups commands by domain. Anything the frontend
//! `invoke()`s is either here, or in `crate::core`/`crate::engine` where
//! the command is tightly coupled to lifecycle/platform state.

pub mod config_fetch;
pub mod dns;
pub mod network;
pub mod prestart;
pub mod shell;
pub mod theme;
pub mod whitelist;
