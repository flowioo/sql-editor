//! SQL domain primitives — statement splitting, classification, and the
//! row-cell decode macro. Pure functions with no IO; safe to unit-test in
//! isolation.

pub mod classifier;
pub mod splitter;

pub use classifier::{classify_statement, StmtKind};
#[allow(unused_imports)] // re-exported for downstream tests; not used inside the lib
pub use splitter::{split_sql, split_sql_with, Dialect};

/// Decode a single sqlx row cell to a display string, trying the common SQL
/// types in turn. Returns `None` for SQL NULL or types we cannot decode (shown
/// as NULL in the grid).
///
/// Implemented as a macro because sqlx's `Row::try_get` trait bounds only
/// resolve against a concrete database Row type — a generic `<R: Row>` helper
/// cannot express the per-type `Decode<DB>` bounds. The macro expands in the
/// driver module where the Row type is concrete (PgRow / MySqlRow). Defined
/// here (domain) because the supported-type policy is a stable domain rule,
/// even though expansion happens at the infrastructure layer.
///
/// Only types supported by **both** Postgres and MySQL are listed —
/// backend-specific types (e.g. PostgreSQL arrays) are decoded in the
/// driver module via dedicated helpers after this macro returns `None`.
macro_rules! decode_cell {
    ($row:expr, $i:expr) => {{
        let row = &$row;
        let i: usize = $i;
        if let Ok(Some(v)) = row.try_get::<Option<String>, _>(i) {
            Some(v)
        } else if let Ok(Some(v)) = row.try_get::<Option<&str>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<i16>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<i32>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<f32>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveDate>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveTime>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<chrono::NaiveDateTime>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<uuid::Uuid>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(v)) = row.try_get::<Option<serde_json::Value>, _>(i) {
            Some(v.to_string())
        } else if let Ok(Some(_v)) = row.try_get::<Option<Vec<u8>>, _>(i) {
            Some("[BLOB]".to_string())
        } else {
            None
        }
    }};
}

pub(crate) use decode_cell;