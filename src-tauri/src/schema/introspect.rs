use rusqlite::Connection;
use crate::schema::{DatabaseSchema, Index, Table, Column};

pub fn introspect_sqlite(conn: &Connection, path: &str) -> Result<DatabaseSchema, String> {
    let db_name = std::path::Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mut tables = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master \
         WHERE type='table' AND name NOT LIKE 'sqlite_%' \
         ORDER BY name"
    ).map_err(|e| format!("查询表列表失败: {}", e))?;

    let table_names: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| format!("读取表名失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    for table_name in table_names {
        let columns = get_table_columns(conn, &table_name)?;
        let indexes = get_table_indexes(conn, &table_name)?;
        tables.push(Table {
            name: table_name,
            columns,
            indexes,
        });
    }

    Ok(DatabaseSchema {
        database_name: db_name,
        tables,
        captured_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn get_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<Column>, String> {
    // Escape double quotes to prevent injection via crafted table names
    let escaped = table_name.replace('"', "\"\"");
    let pragma = format!("PRAGMA table_info(\"{}\")", escaped);
    let mut stmt = conn.prepare(&pragma)
        .map_err(|e| format!("查询列信息失败 ({})：{}", table_name, e))?;

    let columns: Vec<Column> = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        let data_type: String = row.get(2).unwrap_or_default();
        let notnull: i32 = row.get(3).unwrap_or(0);
        let default_value: Option<String> = row.get(4).unwrap_or(None);
        let pk: i32 = row.get(5).unwrap_or(0);
        Ok(Column {
            name,
            data_type,
            nullable: notnull == 0,
            default_value,
            is_primary_key: pk > 0,
        })
    })
    .map_err(|e| format!("读取列信息失败 ({})：{}", table_name, e))?
    .filter_map(|r: Result<Column, _>| r.ok())
    .collect();

    Ok(columns)
}

fn get_table_indexes(conn: &Connection, table_name: &str) -> Result<Vec<Index>, String> {
    let escaped = table_name.replace('"', "\"\"");
    let pragma = format!("PRAGMA index_list(\"{}\")", escaped);
    let mut stmt = conn.prepare(&pragma)
        .map_err(|e| format!("查询索引列表失败 ({})：{}", table_name, e))?;

    let index_infos: Vec<(String, bool, bool)> = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        let unique: bool = row.get(2).unwrap_or(false);
        let origin: String = row.get(3).unwrap_or_default();
        let is_primary = origin == "pk";
        Ok((name, unique, is_primary))
    })
    .map_err(|e| format!("读取索引列表失败 ({})：{}", table_name, e))?
    .filter_map(|r: Result<(String, bool, bool), _>| r.ok())
    .collect();

    let mut indexes = Vec::new();
    for (idx_name, is_unique, is_primary) in index_infos {
        let idx_escaped = idx_name.replace('"', "\"\"");
        let col_pragma = format!("PRAGMA index_info(\"{}\")", idx_escaped);
        let mut col_stmt = conn.prepare(&col_pragma)
            .map_err(|e| format!("查询索引列失败 ({})：{}", idx_name, e))?;

        let columns: Vec<String> = col_stmt.query_map([], |row| {
            row.get::<_, String>(2)
        })
        .map_err(|e| format!("读取索引列失败 ({})：{}", idx_name, e))?
        .filter_map(|r| r.ok())
        .collect();

        indexes.push(Index {
            name: idx_name,
            columns,
            is_unique,
            is_primary,
        });
    }

    Ok(indexes)
}
