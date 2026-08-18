use std::sync::Mutex;
use sqlx::PgPool;
use sqlx::postgres::PgConnectOptions;
use sqlx::{Row as SqlxRow, Column as SqlxColumn};
use futures::StreamExt;
use crate::application::ports::DriverGateway;
use crate::db::{StatementResult, StmtKind, classify_statement, decode_cell};
use crate::db::sqlx_common::MAX_ROWS;
use crate::domain::sql::Dialect;
use crate::schema::{DatabaseSchema, Table, Column};

/// Map a sqlx error to a user-facing message that never contains the
/// connection string or password. DB-side messages are safe to surface —
/// they originate from the server, not from our credentials.
fn classify_pg_error(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Io(_) => "无法连接到数据库服务器（网络不可达或服务未启动）".to_string(),
        sqlx::Error::Database(db) => match db.code().as_deref() {
            // 28000/28P01 = PostgreSQL auth failures; 3D000 = undefined database.
            Some("28000") | Some("28P01") => "数据库认证失败（用户名或密码错误）".to_string(),
            Some("3D000") => "数据库不存在".to_string(),
            _ => format!("数据库返回错误: {}", db.message()),
        },
        _ => "连接数据库失败，请检查主机、端口和数据库配置".to_string(),
    }
}

pub struct PostgresDriver {
    pool: Mutex<PgPool>,
    conn_key: String,
}

impl PostgresDriver {
    pub async fn new(
        host: &str,
        port: u16,
        user: &str,
        password: &str,
        database: &str,
        url: Option<&str>,
    ) -> Result<Self, String> {
        // Build connect options WITHOUT embedding credentials into a URL
        // string. Using PgConnectOptions directly avoids ever materializing a
        // `postgres://user:password@host` string that could leak via error
        // messages or logs, and correctly handles passwords containing
        // URL-special characters (@, :, /, %, ...).
        let opts: PgConnectOptions = match url {
            Some(u) => u
                .parse()
                .map_err(|_| "无效的 PostgreSQL 连接 URL".to_string())?,
            None => PgConnectOptions::new()
                .host(host)
                .port(port)
                .username(user)
                .password(password)
                .database(database),
        };

        let pool = PgPool::connect_with(opts)
            .await
            .map_err(|e| classify_pg_error(&e))?;

        // Verify connection works
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| classify_pg_error(&e))?;

        let conn_key = format!("postgres://{}@{}:{}/{}", user, host, port, database);
        Ok(Self {
            pool: Mutex::new(pool),
            conn_key,
        })
    }
}

async fn get_pg_columns(pool: &PgPool, table_name: &str) -> Result<Vec<Column>, String> {
    let pk_columns: Vec<String> = sqlx::query_scalar(
        "SELECT kcu.column_name \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name \
           AND tc.table_schema = kcu.table_schema \
         WHERE tc.table_schema = 'public' \
           AND tc.table_name = $1 \
           AND tc.constraint_type = 'PRIMARY KEY'"
    )
    .bind(table_name)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let col_rows = sqlx::query(
        "SELECT column_name, data_type, is_nullable, column_default \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = $1 \
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
        let is_pk = pk_columns.contains(&name);

        columns.push(Column {
            name,
            data_type,
            nullable: nullable_str == "YES",
            default_value,
            is_primary_key: is_pk,
        });
    }

    Ok(columns)
}

async fn get_pg_indexes(pool: &PgPool, table_name: &str) -> Result<Vec<crate::schema::Index>, String> {
    use crate::schema::Index;

    let rows = sqlx::query(
        "SELECT i.relname AS index_name,
                a.attname AS column_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary
         FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relname = $1
         ORDER BY i.relname, a.attnum"
    )
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询索引失败 ({}): {}", table_name, e))?;

    // Group by index name
    let mut map: std::collections::BTreeMap<String, (bool, bool, Vec<String>)> = std::collections::BTreeMap::new();
    for row in &rows {
        let idx_name: String = row.get(0);
        let col_name: String = row.get(1);
        let is_unique: bool = row.get(2);
        let is_primary: bool = row.get(3);
        let entry = map.entry(idx_name).or_insert((is_unique, is_primary, vec![]));
        entry.2.push(col_name);
    }

    Ok(map.into_iter().map(|(name, (is_unique, is_primary, columns))| Index {
        name,
        columns,
        is_unique,
        is_primary,
    }).collect())
}

async fn get_schema_async(pool: &PgPool, conn_key: &str) -> Result<DatabaseSchema, String> {
    let db_name = conn_key.rsplit('/').next().unwrap_or("unknown").to_string();

    let table_rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
         ORDER BY table_name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询表列表失败: {}", e))?;

    let mut tables = Vec::new();
    for table_row in &table_rows {
        let table_name: String = table_row.get(0);
        let columns = get_pg_columns(pool, &table_name).await?;
        let indexes = get_pg_indexes(pool, &table_name).await?;
        tables.push(Table { name: table_name, columns, indexes });
    }

    Ok(DatabaseSchema {
        database_name: db_name,
        tables,
        captured_at: chrono::Utc::now().to_rfc3339(),
    })
}

impl PostgresDriver {
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

        // Stream rows instead of `fetch_all` — a single user-supplied
        // `SELECT *` against a billion-row table would otherwise allocate
        // unbounded memory before we ever reach the truncation cap.
        let mut stream = sqlx::query(sql).fetch(&pool);
        let mut column_count = 0usize;
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
impl DriverGateway for PostgresDriver {
    async fn execute_single(&self, sql: &str) -> Result<StatementResult, String> {
        PostgresDriver::execute_single(self, sql).await
    }
    async fn get_schema(&self) -> Result<crate::schema::DatabaseSchema, String> {
        PostgresDriver::get_schema(self).await
    }
    fn dialect(&self) -> Option<Dialect> {
        Some(Dialect::postgres())
    }
}
