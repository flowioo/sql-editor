use std::sync::Mutex;
use sqlx::PgPool;
use sqlx::postgres::PgRow;
use sqlx::{Row as SqlxRow, Column as SqlxColumn};
use crate::db::{DatabaseDriver, QueryResult};
use crate::schema::{DatabaseSchema, Table, Column};

const MAX_ROWS: usize = 10_000;

pub struct PostgresDriver {
    pool: Mutex<Option<PgPool>>,
    conn_key: String,
}

impl PostgresDriver {
    pub async fn new(
        host: &str,
        port: u16,
        user: &str,
        password: &str,
        database: &str,
    ) -> Result<Self, String> {
        let url = format!(
            "postgres://{}:{}@{}:{}/{}",
            user, password, host, port, database
        );
        let pool = PgPool::connect(&url)
            .await
            .map_err(|e| format!("无法连接 PostgreSQL: {}", e))?;

        // Verify connection works
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| format!("连接测试失败: {}", e))?;

        let conn_key = format!("postgres://{}@{}:{}/{}", user, host, port, database);
        Ok(Self {
            pool: Mutex::new(Some(pool)),
            conn_key,
        })
    }

    pub fn connection_key(&self) -> &str {
        &self.conn_key
    }

    fn with_pool<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&PgPool) -> R,
    {
        let guard = self.pool.lock().map_err(|e| e.to_string())?;
        let pool = guard.as_ref().ok_or("连接已关闭".to_string())?;
        Ok(f(pool))
    }
}

async fn execute_query_async(pool: &PgPool, sql: &str) -> Result<QueryResult, String> {
    let rows: Vec<PgRow> = match sqlx::query(sql).fetch_all(pool).await {
        Ok(r) => r,
        Err(_) => {
            let result = sqlx::query(sql)
                .execute(pool)
                .await
                .map_err(|e| format!("SQL 执行错误: {}", e))?;
            return Ok(QueryResult {
                columns: vec!["影响行数".to_string()],
                rows: vec![vec![Some(result.rows_affected().to_string())]],
                affected_rows: result.rows_affected(),
                truncated: false,
            });
        }
    };

    let columns: Vec<String> = if rows.is_empty() {
        vec![]
    } else {
        rows[0].columns().iter().map(|c| c.name().to_string()).collect()
    };

    let column_count = columns.len();
    let mut result_rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut truncated = false;

    for row in &rows {
        if result_rows.len() >= MAX_ROWS {
            truncated = true;
            break;
        }
        let mut row_data: Vec<Option<String>> = Vec::with_capacity(column_count);
        for i in 0..column_count {
            let val: Option<String> = row.try_get(i)
                .ok()
                .or_else(|| row.try_get::<Option<&str>, _>(i).ok().flatten().map(|s| s.to_string()))
                .or_else(|| row.try_get::<Option<i64>, _>(i).ok().flatten().map(|n| n.to_string()))
                .or_else(|| row.try_get::<Option<f64>, _>(i).ok().flatten().map(|f| f.to_string()))
                .or_else(|| row.try_get::<Option<bool>, _>(i).ok().flatten().map(|b| b.to_string()));
            row_data.push(val);
        }
        result_rows.push(row_data);
    }

    let affected = result_rows.len() as u64;
    Ok(QueryResult {
        columns,
        rows: result_rows,
        affected_rows: affected,
        truncated,
    })
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
        tables.push(Table { name: table_name, columns });
    }

    Ok(DatabaseSchema {
        database_name: db_name,
        tables,
        captured_at: chrono::Utc::now().to_rfc3339(),
    })
}

impl DatabaseDriver for PostgresDriver {
    fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        self.with_pool(|pool| {
            let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            rt.block_on(execute_query_async(pool, sql))
        })?
    }

    fn get_schema(&self) -> Result<DatabaseSchema, String> {
        let conn_key = self.conn_key.clone();
        self.with_pool(|pool| {
            let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            rt.block_on(get_schema_async(pool, &conn_key))
        })?
    }

    fn test_connection(&self) -> Result<(), String> {
        // Already tested during new()
        Ok(())
    }
}
