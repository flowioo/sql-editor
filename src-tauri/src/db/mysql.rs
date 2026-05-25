use std::sync::Mutex;
use sqlx::MySqlPool;
use sqlx::mysql::MySqlRow;
use sqlx::{Row as SqlxRow, Column as SqlxColumn};
use crate::db::QueryResult;
use crate::schema::{DatabaseSchema, Table, Column};

const MAX_ROWS: usize = 10_000;

pub struct MySqlDriver {
    pool: Mutex<Option<MySqlPool>>,
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
        let connection_url = url.map(|s| s.to_string()).unwrap_or_else(|| {
            format!("mysql://{}:{}@{}:{}/{}", user, password, host, port, database)
        });
        let pool = MySqlPool::connect(&connection_url)
            .await
            .map_err(|e| format!("无法连接 MySQL: {}", e))?;

        // Verify connection works
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| format!("连接测试失败: {}", e))?;

        let conn_key = format!("mysql://{}@{}:{}/{}", user, host, port, database);
        Ok(Self {
            pool: Mutex::new(Some(pool)),
            conn_key,
        })
    }

    pub fn connection_key(&self) -> &str {
        &self.conn_key
    }
}

async fn execute_query_async(pool: &MySqlPool, sql: &str) -> Result<QueryResult, String> {
    let rows: Vec<MySqlRow> = match sqlx::query(sql).fetch_all(pool).await {
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
        tables.push(Table { name: table_name, columns });
    }

    Ok(DatabaseSchema {
        database_name: db_name,
        tables,
        captured_at: chrono::Utc::now().to_rfc3339(),
    })
}

impl MySqlDriver {
    pub async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let pool = {
            let guard = self.pool.lock().map_err(|e| e.to_string())?;
            guard.as_ref().cloned().ok_or("连接已关闭".to_string())?
        };
        execute_query_async(&pool, sql).await
    }

    pub async fn get_schema(&self) -> Result<DatabaseSchema, String> {
        let pool = {
            let guard = self.pool.lock().map_err(|e| e.to_string())?;
            guard.as_ref().cloned().ok_or("连接已关闭".to_string())?
        };
        get_schema_async(&pool, &self.conn_key).await
    }

    pub fn test_connection(&self) -> Result<(), String> {
        Ok(())
    }
}
