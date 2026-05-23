pub mod sqlite;

use serde::Serialize;
use crate::schema::DatabaseSchema;

#[derive(Serialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: u64,
    pub truncated: bool,
}

pub trait DatabaseDriver: Send + Sync {
    fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;
    fn get_schema(&self) -> Result<DatabaseSchema, String>;
    fn test_connection(&self) -> Result<(), String>;
}
