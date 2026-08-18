//! Ports — traits the application layer depends on, implemented by the
//! infrastructure layer. This is the seam that lets us swap drivers or
//! repositories without touching use-case logic.

use async_trait::async_trait;
use std::time::Instant;

use crate::db::{MultiQueryResult, StatementResult};
use crate::domain::sql::{Dialect, split_sql_with};
use crate::schema::DatabaseSchema;

/// Unified database driver gateway. Each backend (SQLite/PostgreSQL/MySQL)
/// implements `execute_single` + `get_schema`; multi-statement orchestration
/// lives in `execute_multi_query` below and is shared by all backends. Adding
/// a new database type means implementing this trait — no enum edits, no
/// match arms scattered across the codebase (open/closed principle).
#[async_trait]
pub trait DriverGateway: Send + Sync {
    /// Execute a single SQL statement and return its result.
    async fn execute_single(&self, sql: &str) -> Result<StatementResult, String>;

    /// Introspect the database schema.
    async fn get_schema(&self) -> Result<DatabaseSchema, String>;

    /// The SQL dialect this driver speaks, used to drive the statement
    /// splitter. `None` means the input is not SQL (e.g. Redis command
    /// stream) and should be split per-line instead — each line is one
    /// command, dispatched independently.
    fn dialect(&self) -> Option<Dialect> {
        None
    }
}

/// Execute multiple statements against any `DriverGateway`, aggregating
/// per-statement results. A failing statement is recorded with its error
/// rather than aborting the batch. Shared by all backends — drivers only
/// implement `execute_single`.
///
/// Splitting strategy:
///   * SQL drivers (PG/MySQL/SQLite): split by `;` using the driver's
///     `dialect`, which selects dialect-specific quote/comment rules.
///   * Non-SQL drivers (Redis): split on non-empty lines, dispatching one
///     command per line — `split_sql` would mangle `SET "a;b" 1` etc.
pub async fn execute_multi_query(
    driver: &dyn DriverGateway,
    sql: &str,
) -> Result<MultiQueryResult, String> {
    let statements: Vec<String> = match driver.dialect() {
        Some(dialect) => split_sql_with(sql, &dialect),
        None => sql
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
    };

    let start = Instant::now();
    let mut results = Vec::with_capacity(statements.len());
    for stmt in &statements {
        match driver.execute_single(stmt).await {
            Ok(sr) => results.push(sr),
            Err(e) => results.push(StatementResult {
                sql: stmt.to_string(),
                columns: vec![],
                rows: vec![],
                affected_rows: 0,
                truncated: false,
                is_query: false,
                error: Some(e),
            }),
        }
    }
    Ok(MultiQueryResult {
        results,
        total_duration_ms: start.elapsed().as_millis() as u64,
    })
}