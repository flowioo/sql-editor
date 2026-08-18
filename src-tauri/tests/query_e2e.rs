//! End-to-end query tests against an in-memory SQLite database.
//!
//! Validates the full query pipeline after the DDD refactor:
//!   `SqliteDriver` (build) → `DriverGateway` (trait) → `execute_multi_query`
//!   (split_sql + per-statement `execute_single`) → `StatementResult` /
//!   `MultiQueryResult`.
//!
//! These drive the domain gateways directly (no Tauri IPC). The Tauri
//! `execute_query` / `refresh_schema` commands are thin adapters over the very
//! same `execute_multi_query` / `DriverGateway::get_schema`, so this covers the
//! query execution contract end-to-end modulo the IPC boundary.

use sql_editor_lib::application::ports::{execute_multi_query, DriverGateway};
use sql_editor_lib::db::sqlite::SqliteDriver;
use sql_editor_lib::db::StatementResult;

/// A fresh in-memory SQLite driver. Each test gets its own isolated database
/// (rusqlite's `:memory:` is per-connection).
fn mem() -> SqliteDriver {
    SqliteDriver::new(":memory:").expect("failed to open in-memory sqlite")
}

/// Run a single statement via the shared multi-statement path. Goes through
/// `execute_multi_query` so we exercise split_sql + DriverGateway dispatch
/// exactly as the `execute_query` command does.
async fn run_one(driver: &SqliteDriver, sql: &str) -> StatementResult {
    execute_multi_query(driver, sql)
        .await
        .expect("multi query should not hard-fail")
        .results
        .into_iter()
        .next()
        .expect("at least one statement result")
}

#[tokio::test]
async fn select_returns_rows_and_columns() {
    let driver = mem();
    run_one(&driver, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)").await;
    run_one(&driver, "INSERT INTO users (id, name) VALUES (1, 'alice'), (2, 'bob')").await;

    let r = run_one(&driver, "SELECT id, name FROM users ORDER BY id").await;
    assert!(r.is_query, "SELECT classified as a row-returning query");
    assert!(r.error.is_none());
    assert_eq!(r.columns, vec!["id", "name"]);
    assert_eq!(r.rows.len(), 2);
    assert_eq!(r.rows[0], vec![Some("1".into()), Some("alice".into())]);
    assert_eq!(r.rows[1], vec![Some("2".into()), Some("bob".into())]);
}

#[tokio::test]
async fn multi_query_splits_three_statements() {
    let driver = mem();
    let result = execute_multi_query(&driver, "SELECT 1; SELECT 2; SELECT 3;")
        .await
        .expect("multi query ok");
    assert_eq!(result.results.len(), 3, "three `;`-separated statements");
    assert_eq!(result.results[0].rows[0][0].as_deref(), Some("1"));
    assert_eq!(result.results[1].rows[0][0].as_deref(), Some("2"));
    assert_eq!(result.results[2].rows[0][0].as_deref(), Some("3"));
}

#[tokio::test]
async fn failing_statement_isolates_error_and_continues() {
    let driver = mem();
    // Middle statement is invalid — the batch must record its error on that
    // result only and keep going (this is the error-isolation contract that
    // lets the UI show per-statement failures without aborting the run).
    let result = execute_multi_query(&driver, "SELECT 1; THIS IS NOT SQL; SELECT 3;")
        .await
        .expect("batch must not hard-fail on one bad statement");
    assert_eq!(result.results.len(), 3);
    assert!(result.results[0].error.is_none(), "first statement ok");
    assert!(result.results[1].error.is_some(), "middle statement records its error");
    assert!(result.results[2].error.is_none(), "batch continues past the error");
    assert_eq!(result.results[2].rows[0][0].as_deref(), Some("3"));
}

#[tokio::test]
async fn dml_reports_affected_rows() {
    let driver = mem();
    run_one(&driver, "CREATE TABLE t (id INTEGER)").await;
    let r = run_one(&driver, "INSERT INTO t VALUES (1), (2), (3)").await;
    assert!(!r.is_query, "INSERT is not a row-returning query");
    assert!(r.error.is_none());
    assert_eq!(r.affected_rows, 3, "INSERT of 3 rows reports 3 affected");
}

#[tokio::test]
async fn semicolon_inside_string_literal_is_not_split() {
    let driver = mem();
    let result = execute_multi_query(&driver, "SELECT ';' AS s;")
        .await
        .expect("query ok");
    assert_eq!(result.results.len(), 1, "the ';' inside the string must not split");
    assert_eq!(result.results[0].rows[0][0].as_deref(), Some(";"));
    assert_eq!(result.results[0].columns.as_slice(), &["s"], "column alias preserved");
}

#[tokio::test]
async fn schema_introspection_returns_tables_and_primary_key() {
    let driver = mem();
    run_one(&driver, "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)").await;
    run_one(&driver, "CREATE TABLE logs (seq INTEGER, msg TEXT)").await;

    let schema = DriverGateway::get_schema(&driver).await.expect("get_schema");
    assert_eq!(schema.tables.len(), 2, "both tables introspected");
    // sqlite_master introspection is ORDER BY name → logs, users
    assert_eq!(schema.tables[0].name, "logs");
    assert_eq!(schema.tables[1].name, "users");

    let id_col = schema.tables[1]
        .columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column present");
    assert!(id_col.is_primary_key, "`INTEGER PRIMARY KEY` detected as PK");

    let email = schema.tables[1]
        .columns
        .iter()
        .find(|c| c.name == "email")
        .expect("email column present");
    assert!(!email.nullable, "NOT NULL constraint honored");
}
