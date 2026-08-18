//! Application layer — use-case orchestration. Depends on `domain` and on
//! the port traits defined here; infrastructure (drivers, repositories)
//! implements those traits. Commands are thin adapters that call these
//! services.

pub mod ports;
