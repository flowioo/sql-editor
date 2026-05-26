use std::sync::Mutex;
use rusqlite::{Connection, params};
use rusqlite::types::ValueRef;
use crate::db::{QueryResult, StatementResult};
use crate::schema::introspect;

const MAX_ROWS: usize = 10_000;

pub struct SqliteDriver {
    conn: Mutex<Connection>,
    path: String,
}

impl SqliteDriver {
    pub fn new(path: &str) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("无法打开数据库文件: {}", e))?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_string(),
        })
    }

}

fn value_to_string(val: ValueRef<'_>) -> Option<String> {
    match val {
        ValueRef::Null => None,
        ValueRef::Integer(n) => Some(n.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Text(s) => Some(String::from_utf8_lossy(s).to_string()),
        ValueRef::Blob(_) => Some("[BLOB]".to_string()),
    }
}

impl SqliteDriver {
    pub fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Try as a SELECT/PRAGMA query first
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => {
                // Not a SELECT — execute as a write statement
                let affected = conn.execute(sql, [])
                    .map_err(|e| format!("SQL 执行错误: {}", e))?;
                return Ok(QueryResult {
                    columns: vec!["影响行数".to_string()],
                    rows: vec![vec![Some(affected.to_string())]],
                    affected_rows: affected as u64,
                    truncated: false,
                });
            }
        };

        let column_names: Vec<String> = stmt.column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();

        let column_count = column_names.len();
        let mut rows: Vec<Vec<Option<String>>> = Vec::new();
        let mut truncated = false;

        let mut result_iter = stmt.query(params![])
            .map_err(|e| format!("查询执行错误: {}", e))?;

        while let Some(row) = result_iter.next().map_err(|e| format!("读取行错误: {}", e))? {
            if rows.len() >= MAX_ROWS {
                truncated = true;
                break;
            }
            let mut row_data: Vec<Option<String>> = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let value = row.get_ref(i)
                    .ok()
                    .and_then(value_to_string);
                row_data.push(value);
            }
            rows.push(row_data);
        }

        let affected = rows.len() as u64;
        Ok(QueryResult {
            columns: column_names,
            rows,
            affected_rows: affected,
            truncated,
        })
    }

    pub fn get_schema(&self) -> Result<crate::schema::DatabaseSchema, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        introspect::introspect_sqlite(&conn, &self.path)
    }

    pub fn test_connection(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("SELECT 1")
            .map_err(|e| format!("连接测试失败: {}", e))?;
        Ok(())
    }

    pub fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Try as a SELECT/PRAGMA query first
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => {
                // Not a SELECT — execute as a write statement
                let affected = conn.execute(sql, [])
                    .map_err(|e| format!("SQL 执行错误: {e}"))?;
                return Ok(StatementResult {
                    sql: sql.to_string(),
                    columns: vec!["影响行数".to_string()],
                    rows: vec![vec![Some(affected.to_string())]],
                    affected_rows: affected as u64,
                    truncated: false,
                    is_query: false,
                    error: None,
                });
            }
        };

        let column_names: Vec<String> = stmt.column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();

        let column_count = column_names.len();
        let mut result_rows: Vec<Vec<Option<String>>> = Vec::new();
        let mut truncated = false;

        let mut result_iter = stmt.query(params![])
            .map_err(|e| format!("查询执行错误: {e}"))?;

        while let Some(row) = result_iter.next().map_err(|e| format!("读取行错误: {e}"))? {
            if result_rows.len() >= MAX_ROWS {
                truncated = true;
                break;
            }
            let mut row_data: Vec<Option<String>> = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let value = row.get_ref(i)
                    .ok()
                    .and_then(value_to_string);
                row_data.push(value);
            }
            result_rows.push(row_data);
        }

        let affected = result_rows.len() as u64;
        Ok(StatementResult {
            sql: sql.to_string(),
            columns: column_names,
            rows: result_rows,
            affected_rows: affected,
            truncated,
            is_query: true,
            error: None,
        })
    }
}
