//! Domain layer — pure domain models, value objects, and domain services.
//!
//! This layer has **no dependency on infrastructure** (sqlx, rusqlite, tauri).
//! It only depends on `serde`, `chrono`, and the standard library. Keeping the
//! domain pure is what lets us unit-test SQL parsing/schema diffing without a
//! database, and swap drivers without touching domain rules.

pub mod sql;
