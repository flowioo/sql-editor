use rusqlite::{Connection, params};
use crate::schema::DatabaseSchema;
use crate::schema::scanner::ColumnDescription;

pub fn ensure_cache_db(cache_db_path: &str) -> Result<(), String> {
    let conn = Connection::open(cache_db_path)
        .map_err(|e| format!("无法创建缓存数据库: {}", e))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_key TEXT NOT NULL,
            db_name TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            schema_json TEXT NOT NULL,
            UNIQUE(connection_key, db_name)
        );

        CREATE TABLE IF NOT EXISTS column_descriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_key TEXT NOT NULL,
            db_name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            file_path TEXT NOT NULL DEFAULT '',
            UNIQUE(connection_key, db_name, table_name, column_name)
        );"
    ).map_err(|e| format!("创建缓存表失败: {}", e))?;

    Ok(())
}

pub fn save_schema(
    cache_db_path: &str,
    connection_key: &str,
    schema: &DatabaseSchema,
) -> Result<(), String> {
    let conn = Connection::open(cache_db_path)
        .map_err(|e| format!("无法打开缓存数据库: {}", e))?;

    let schema_json = serde_json::to_string(schema)
        .map_err(|e| format!("序列化 schema 失败: {}", e))?;

    conn.execute(
        "INSERT OR REPLACE INTO schema_snapshots (connection_key, db_name, captured_at, schema_json) \
         VALUES (?1, ?2, ?3, ?4)",
        params![connection_key, schema.database_name, schema.captured_at, schema_json],
    ).map_err(|e| format!("保存 schema 失败: {}", e))?;

    Ok(())
}

pub fn load_schema(
    cache_db_path: &str,
    connection_key: &str,
) -> Result<Option<DatabaseSchema>, String> {
    let conn = Connection::open(cache_db_path)
        .map_err(|e| format!("无法打开缓存数据库: {}", e))?;

    let result = conn.query_row(
        "SELECT schema_json FROM schema_snapshots \
         WHERE connection_key = ?1 \
         ORDER BY captured_at DESC LIMIT 1",
        params![connection_key],
        |row| {
            let json: String = row.get(0)?;
            Ok(json)
        },
    );

    match result {
        Ok(json) => {
            let schema: DatabaseSchema = serde_json::from_str(&json)
                .map_err(|e| format!("解析缓存 schema 失败: {}", e))?;
            Ok(Some(schema))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("加载缓存失败: {}", e)),
    }
}

pub fn save_column_descriptions(
    cache_db_path: &str,
    connection_key: &str,
    db_name: &str,
    descriptions: &[ColumnDescription],
) -> Result<usize, String> {
    let conn = Connection::open(cache_db_path)
        .map_err(|e| format!("无法打开缓存数据库: {}", e))?;

    let mut count = 0usize;
    for desc in descriptions {
        conn.execute(
            "INSERT OR REPLACE INTO column_descriptions \
             (connection_key, db_name, table_name, column_name, description, source, file_path) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                connection_key,
                db_name,
                desc.table_name,
                desc.column_name,
                desc.description,
                desc.source,
                desc.file_path,
            ],
        )
        .map_err(|e| format!("保存列描述失败: {}", e))?;
        count += 1;
    }

    Ok(count)
}

pub fn load_column_descriptions(
    cache_db_path: &str,
    connection_key: &str,
    db_name: &str,
    table_name: &str,
) -> Result<Vec<ColumnDescription>, String> {
    let conn = Connection::open(cache_db_path)
        .map_err(|e| format!("无法打开缓存数据库: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT table_name, column_name, description, source, file_path \
             FROM column_descriptions \
             WHERE connection_key = ?1 AND db_name = ?2 AND table_name = ?3",
        )
        .map_err(|e| format!("查询列描述失败: {}", e))?;

    let rows = stmt
        .query_map(params![connection_key, db_name, table_name], |row| {
            Ok(ColumnDescription {
                table_name: row.get(0)?,
                column_name: row.get(1)?,
                description: row.get(2)?,
                source: row.get(3)?,
                file_path: row.get(4)?,
            })
        })
        .map_err(|e| format!("读取列描述失败: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析列描述失败: {}", e))?);
    }

    Ok(result)
}

pub fn load_all_column_descriptions(
    cache_db_path: &str,
    connection_key: &str,
) -> Result<Vec<ColumnDescription>, String> {
    let conn = Connection::open(cache_db_path)
        .map_err(|e| format!("无法打开缓存数据库: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT table_name, column_name, description, source, file_path \
             FROM column_descriptions \
             WHERE connection_key = ?1",
        )
        .map_err(|e| format!("查询列描述失败: {}", e))?;

    let rows = stmt
        .query_map(params![connection_key], |row| {
            Ok(ColumnDescription {
                table_name: row.get(0)?,
                column_name: row.get(1)?,
                description: row.get(2)?,
                source: row.get(3)?,
                file_path: row.get(4)?,
            })
        })
        .map_err(|e| format!("读取列描述失败: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析列描述失败: {}", e))?);
    }

    Ok(result)
}
