use std::sync::{Arc, Mutex};
use rusqlite::{Connection, params};
use rusqlite::types::ValueRef;
use crate::application::ports::DriverGateway;
use crate::db::{StatementResult, StmtKind, classify_statement};
use crate::domain::sql::Dialect;
use crate::schema::introspect;

const MAX_ROWS: usize = 10_000;
/// Wait up to 5s for a write-lock holder to finish before failing —
/// prevents spurious SQLITE_BUSY errors under contention.
const BUSY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// SQLite driver. The connection lives behind an `Arc<Mutex<_>>` so we can
/// cheaply clone the handle into `spawn_blocking` — rusqlite is blocking
/// IO and must not sit on the Tokio runtime worker.
pub struct SqliteDriver {
    conn: Arc<Mutex<Connection>>,
    path: String,
}

impl SqliteDriver {
    pub fn new(path: &str) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("无法打开数据库文件: {}", e))?;
        // Best-effort tuning: busy_timeout makes concurrent writers wait
        // instead of returning immediately; WAL improves read/write
        // concurrency. Both are no-ops on platforms / filesystems that
        // don't support them, so we ignore the Result.
        let _ = conn.busy_timeout(BUSY_TIMEOUT);
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: path.to_string(),
        })
    }

    pub fn test_connection(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("SELECT 1")
            .map_err(|e| format!("连接测试失败: {}", e))?;
        Ok(())
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

/// Run one SQL statement synchronously, holding `conn`'s lock for the
/// duration. Caller must invoke from a blocking thread.
fn run_one(conn: &Connection, sql: &str) -> Result<StatementResult, String> {
    if classify_statement(sql) == StmtKind::Execute {
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

    let mut stmt = conn.prepare(sql).map_err(|e| format!("查询执行错误: {e}"))?;

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

// DriverGateway impl — async wrappers around the synchronous rusqlite
// operations above. `spawn_blocking` keeps the blocking IO off the Tokio
// worker; the Mutex is acquired only inside the blocking task and the
// guard lives at most until the task ends.
#[async_trait::async_trait]
impl DriverGateway for SqliteDriver {
    async fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        let sql = sql.to_string();
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || -> Result<StatementResult, String> {
            let guard = conn.lock().map_err(|e| e.to_string())?;
            run_one(&guard, &sql)
        })
        .await
        .map_err(|e| format!("后台任务执行失败: {}", e))?
    }

    async fn get_schema(&self) -> Result<crate::schema::DatabaseSchema, String> {
        let path = self.path.clone();
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || -> Result<crate::schema::DatabaseSchema, String> {
            let guard = conn.lock().map_err(|e| e.to_string())?;
            introspect::introspect_sqlite(&guard, &path)
        })
        .await
        .map_err(|e| format!("后台任务执行失败: {}", e))?
    }

    fn dialect(&self) -> Option<Dialect> {
        Some(Dialect::sqlite())
    }
}