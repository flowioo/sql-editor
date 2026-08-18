//! Shared sqlx helpers for PG / MySQL drivers. Centralising the
//! truncation cap keeps memory bounded: collecting an arbitrary
//! user-supplied `SELECT *` into a Vec without a cap has shipped as
//! "infinite-memory" before — the cap is enforced here.

/// Upper bound on rows collected into a single `StatementResult`. Anything
/// past this is dropped and the `truncated` flag is set so the UI can warn
/// the user.
pub const MAX_ROWS: usize = 10_000;