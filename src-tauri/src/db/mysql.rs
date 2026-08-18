use std::sync::Mutex;
use sqlx::MySqlPool;
use sqlx::mysql::MySqlConnectOptions;
use sqlx::{Row as SqlxRow, Column as SqlxColumn};
use futures::StreamExt;
use crate::application::ports::DriverGateway;
use crate::db::{StatementResult, StmtKind, classify_statement, decode_cell};
use crate::db::sqlx_common::MAX_ROWS;
use crate::domain::sql::Dialect;
use crate::schema::{DatabaseSchema, Index, Table, Column};

/// Map a sqlx error to a user-facing message that never contains the
/// connection string or password. DB-side messages are safe to surface —
/// they originate from the server, not from our credentials.
fn classify_mysql_error(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Io(_) => "无法连接到数据库服务器（网络不可达或服务未启动）".to_string(),
        sqlx::Error::Database(db) => match db.code().as_deref() {
            // 1045 = access denied; 1049 = unknown database.
            Some("1045") => "数据库认证失败（用户名或密码错误）".to_string(),
            Some("1049") => "数据库不存在".to_string(),
            _ => format!("数据库返回错误: {}", db.message()),
        },
        _ => "连接数据库失败，请检查主机、端口和数据库配置".to_string(),
    }
}

pub struct MySqlDriver {
    pool: Mutex<MySqlPool>,
    conn_key: String,
}

impl MySqlDriver {
    pub async fn new(
        host: &str,
        port: u16,
        user: &str,
        password: &str,
        database: &str,
        url: Option<&str>,
    ) -> Result<Self, String> {
        // Build connect options WITHOUT embedding credentials into a URL
        // string. Using MySqlConnectOptions directly avoids ever materializing
        // a `mysql://user:password@host` string that could leak via error
        // messages or logs, and correctly handles passwords containing
        // URL-special characters (@, :, /, %, ...).
        let opts: MySqlConnectOptions = match url {
            Some(u) => u
                .parse()
                .map_err(|_| "无效的 MySQL 连接 URL".to_string())?,
            None => MySqlConnectOptions::new()
                .host(host)
                .port(port)
                .username(user)
                .password(password)
                .database(database),
        };

        let pool = MySqlPool::connect_with(opts)
            .await
            .map_err(|e| classify_mysql_error(&e))?;

        // Verify connection works
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| classify_mysql_error(&e))?;

        let conn_key = format!("mysql://{}@{}:{}/{}", user, host, port, database);
        Ok(Self {
            pool: Mutex::new(pool),
            conn_key,
        })
    }
}

async fn get_mysql_columns(pool: &MySqlPool, table_name: &str) -> Result<Vec<Column>, String> {
    let col_rows = sqlx::query(
        "SELECT column_name, data_type, is_nullable, column_default, \
                CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END AS is_pk \
         FROM information_schema.columns \
         WHERE table_schema = DATABASE() AND table_name = ? \
         ORDER BY ordinal_position"
    )
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询列信息失败 ({}): {}", table_name, e))?;

    let mut columns = Vec::new();
    for row in &col_rows {
        let name: String = row.get(0);
        let data_type: String = row.get(1);
        let nullable_str: String = row.get(2);
        let default_value: Option<String> = row.get(3);
        let is_pk: i32 = row.get(4);

        columns.push(Column {
            name,
            data_type,
            nullable: nullable_str == "YES",
            default_value,
            is_primary_key: is_pk == 1,
        });
    }

    Ok(columns)
}

async fn get_mysql_indexes(pool: &MySqlPool, table_name: &str) -> Result<Vec<Index>, String> {
    let rows = sqlx::query(
        "SELECT s.index_name, s.column_name, s.non_unique, s.seq_in_index
         FROM information_schema.statistics s
         WHERE s.table_schema = DATABASE() AND s.table_name = ?
         ORDER BY s.index_name, s.seq_in_index"
    )
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询索引失败 ({}): {}", table_name, e))?;

    let mut map: std::collections::BTreeMap<String, (bool, Vec<String>)> = std::collections::BTreeMap::new();
    for row in &rows {
        let idx_name: String = row.get(0);
        let col_name: String = row.get(1);
        let non_unique: i32 = row.get(2);
        let entry = map.entry(idx_name).or_insert((non_unique == 0, vec![]));
        entry.1.push(col_name);
    }

    Ok(map.into_iter().map(|(name, (is_unique, columns))| {
        let is_primary = name == "PRIMARY";
        Index { name, columns, is_unique, is_primary }
    }).collect())
}

async fn get_schema_async(pool: &MySqlPool, conn_key: &str) -> Result<DatabaseSchema, String> {
    let db_name = conn_key.rsplit('/').next().unwrap_or("unknown").to_string();

    let table_rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables \
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' \
         ORDER BY table_name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询表列表失败: {}", e))?;

    let mut tables = Vec::new();
    for table_row in &table_rows {
        let table_name: String = table_row.get(0);
        let columns = get_mysql_columns(pool, &table_name).await?;
        let indexes = get_mysql_indexes(pool, &table_name).await?;
        tables.push(Table { name: table_name, columns, indexes });
    }

    Ok(DatabaseSchema {
        database_name: db_name,
        tables,
        captured_at: chrono::Utc::now().to_rfc3339(),
    })
}

impl MySqlDriver {
    pub async fn get_schema(&self) -> Result<DatabaseSchema, String> {
        let pool = self.pool.lock().map_err(|e| e.to_string())?.clone();
        get_schema_async(&pool, &self.conn_key).await
    }

    pub async fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        let pool = self.pool.lock().map_err(|e| e.to_string())?.clone();

        // DML/DDL path — never attempt fetch_all for writes.
        if classify_statement(sql) == StmtKind::Execute {
            let result = sqlx::query(sql)
                .execute(&pool)
                .await
                .map_err(|e| format!("SQL 执行错误: {e}"))?;
            let affected = result.rows_affected();
            return Ok(StatementResult {
                sql: sql.to_string(),
                columns: vec!["影响行数".to_string()],
                rows: vec![vec![Some(affected.to_string())]],
                affected_rows: affected,
                truncated: false,
                is_query: false,
                error: None,
            });
        }

        let mut columns: Vec<String> = Vec::new();
        let mut result_rows: Vec<Vec<Option<String>>> = Vec::new();
        let mut truncated = false;
        let mut column_count = 0usize;

        // Stream rows instead of `fetch_all` — same memory-bound rationale
        // as the Postgres driver: a SELECT * without LIMIT could otherwise
        // exhaust RAM.
        let mut stream = sqlx::query(sql).fetch(&pool);
        while let Some(row_result) = stream.next().await {
            let row = row_result.map_err(|e| format!("SQL 执行错误: {e}"))?;
            if columns.is_empty() {
                columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                column_count = columns.len();
            }
            if result_rows.len() >= MAX_ROWS {
                truncated = true;
                break;
            }
            let mut row_data: Vec<Option<String>> = Vec::with_capacity(column_count);
            for i in 0..column_count {
                row_data.push(decode_cell!(row, i));
            }
            result_rows.push(row_data);
        }

        let affected = result_rows.len() as u64;
        Ok(StatementResult {
            sql: sql.to_string(),
            columns,
            rows: result_rows,
            affected_rows: affected,
            truncated,
            is_query: true,
            error: None,
        })
    }
}

#[async_trait::async_trait]
impl DriverGateway for MySqlDriver {
    async fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        MySqlDriver::execute_single(self, sql).await
    }
    async fn get_schema(&self) -> Result<crate::schema::DatabaseSchema, String> {
        MySqlDriver::get_schema(self).await
    }
    fn dialect(&self) -> Option<Dialect> {
        Some(Dialect::mysql())
    }
}
