//! End-to-end tests for `execute_multi_query`'s splitting strategy:
//! SQL drivers use `split_sql_with` (dialect-aware); non-SQL drivers
//! (e.g. Redis, identified by `dialect() == None`) split per-line. A
//! mock driver is used so we do not need a live Redis server.

use async_trait::async_trait;
use std::sync::Mutex;
use sql_editor_lib::application::ports::{execute_multi_query, DriverGateway};
use sql_editor_lib::db::StatementResult;
use sql_editor_lib::domain::sql::Dialect;
use sql_editor_lib::schema::DatabaseSchema;

#[derive(Default)]
struct CapturingMock {
    seen: Mutex<Vec<String>>,
}

#[async_trait]
impl DriverGateway for CapturingMock {
    async fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        self.seen.lock().unwrap().push(sql.to_string());
        Ok(StatementResult {
            sql: sql.to_string(),
            columns: vec!["value".to_string()],
            rows: vec![vec![Some("OK".to_string())]],
            affected_rows: 1,
            truncated: false,
            is_query: true,
            error: None,
        })
    }
    async fn get_schema(&self) -> Result<DatabaseSchema, String> {
        Ok(DatabaseSchema {
            database_name: "mock".to_string(),
            tables: Vec::new(),
            captured_at: "2026-08-17T00:00:00Z".to_string(),
        })
    }
    fn dialect(&self) -> Option<Dialect> {
        None // marks this as a non-SQL, line-based driver
    }
}

#[tokio::test]
async fn line_based_split_dispatches_one_command_per_line() {
    let driver = CapturingMock::default();
    let input = "PING\nSET k v\nGET k";
    let result = execute_multi_query(&driver, input)
        .await
        .expect("multi query ok");
    assert_eq!(result.results.len(), 3, "three lines, three statements");
    let captured = driver.seen.lock().unwrap().clone();
    assert_eq!(captured, vec!["PING", "SET k v", "GET k"]);
}

#[tokio::test]
async fn line_based_split_drops_blank_lines() {
    let driver = CapturingMock::default();
    let input = "\nPING\n\n\nGET k\n\n";
    let result = execute_multi_query(&driver, input)
        .await
        .expect("multi query ok");
    assert_eq!(result.results.len(), 2, "blank lines dropped");
    let captured = driver.seen.lock().unwrap().clone();
    assert_eq!(captured, vec!["PING", "GET k"]);
}

#[tokio::test]
async fn line_based_split_keeps_quoted_semicolons_intact() {
    // The whole point of line-based splitting for Redis is to NOT split
    // on `;` — a command like `SET "a;b" 1` must arrive at the driver
    // verbatim. With `dialect() == None` we don't go through
    // `split_sql_with` at all, so the quoted `;` is safe.
    let driver = CapturingMock::default();
    let input = "SET \"a;b\" 1";
    let result = execute_multi_query(&driver, input)
        .await
        .expect("multi query ok");
    assert_eq!(result.results.len(), 1, "single line, one statement");
    let captured = driver.seen.lock().unwrap().clone();
    assert_eq!(captured, vec!["SET \"a;b\" 1"]);
}