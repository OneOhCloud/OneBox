//! Cross-platform engine primitives: sidecar path resolution, readiness
//! probing, the lifecycle state machine, and the system-proxy wrapper.
//! These don't depend on any one OS and are shared by all three
//! `EngineManager` implementations.

pub mod helper;
pub mod readiness;
pub mod state_machine;
pub(crate) mod sysproxy;
