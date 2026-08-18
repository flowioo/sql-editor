use tauri::State;
use crate::AppState;
use crate::schema::DatabaseSchema;
use crate::schema::scanner::{self, ColumnDescription, ScanResult};
use crate::schema::persist;

#[tauri::command]
pub async fn refresh_schema(state: State<'_, AppState>) -> Result<DatabaseSchema, String> {
    // Acquire (driver, key) under a single lock — two separate locks would
    // race against a concurrent `connect` and could observe a half-swapped
    // driver+key pair.
    let (driver, key) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let driver = inner.driver.clone().ok_or("未连接到数据库".to_string())?;
        let key = inner.current_connection_key.clone().ok_or("未连接到数据库".to_string())?;
        (driver, key)
    };

    let schema = driver.get_schema().await?;

    // Cache writes hit SQLite on disk — keep them off the main runtime
    // worker.
    let cache_path = state.cache_db_path.clone();
    let schema_for_disk = schema.clone();
    let key_for_disk = key.clone();
    tokio::task::spawn_blocking(move || persist::save_schema(&cache_path, &key_for_disk, &schema_for_disk))
        .await
        .map_err(|e| format!("后台任务执行失败: {}", e))??;

    {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, schema.clone());
    }

    Ok(schema)
}

#[tauri::command]
pub async fn get_cached_schema(state: State<'_, AppState>) -> Result<Option<DatabaseSchema>, String> {
    let key = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.current_connection_key.clone()
            .ok_or("未连接到数据库".to_string())?
    };

    // Read from in-memory cache first; on miss fall back to disk without
    // blocking the runtime worker.
    let cached = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.get(&key).cloned()
    };

    if let Some(schema) = cached {
        return Ok(Some(schema));
    }

    let cache_path = state.cache_db_path.clone();
    let key_for_disk = key.clone();
    let schema = tokio::task::spawn_blocking(move || persist::load_schema(&cache_path, &key_for_disk))
        .await
        .map_err(|e| format!("后台任务执行失败: {}", e))??;

    if let Some(ref s) = schema {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, s.clone());
    }

    Ok(schema)
}

#[derive(serde::Serialize)]
pub struct SchemaDiffResult {
    pub has_changes: bool,
    pub schema: DatabaseSchema,
}

#[tauri::command]
pub async fn diff_schema(state: State<'_, AppState>) -> Result<SchemaDiffResult, String> {
    // Single lock so the (driver, key) snapshot is consistent.
    let (driver, key) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let driver = inner.driver.clone().ok_or("未连接到数据库".to_string())?;
        let key = inner.current_connection_key.clone().ok_or("未连接到数据库".to_string())?;
        (driver, key)
    };

    let remote_schema = driver.get_schema().await?;

    let cache_path = state.cache_db_path.clone();
    let key_for_disk = key.clone();
    let cached_schema = tokio::task::spawn_blocking(move || persist::load_schema(&cache_path, &key_for_disk))
        .await
        .map_err(|e| format!("后台任务执行失败: {}", e))??;

    let has_changes = match &cached_schema {
        None => true,
        Some(cached) => schema_changed(cached, &remote_schema),
    };

    if has_changes {
        let cache_path = state.cache_db_path.clone();
        let key_for_disk = key.clone();
        let schema_for_disk = remote_schema.clone();
        tokio::task::spawn_blocking(move || persist::save_schema(&cache_path, &key_for_disk, &schema_for_disk))
            .await
            .map_err(|e| format!("后台任务执行失败: {}", e))??;
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, remote_schema.clone());
    }

    Ok(SchemaDiffResult {
        has_changes,
        schema: remote_schema,
    })
}

fn schema_changed(cached: &DatabaseSchema, remote: &DatabaseSchema) -> bool {
    if cached.tables.len() != remote.tables.len() {
        return true;
    }

    let cached_table_names: Vec<&str> = cached.tables.iter().map(|t| t.name.as_str()).collect();
    let remote_table_names: Vec<&str> = remote.tables.iter().map(|t| t.name.as_str()).collect();
    if cached_table_names != remote_table_names {
        return true;
    }

    for (ct, rt) in cached.tables.iter().zip(remote.tables.iter()) {
        if ct.name != rt.name || ct.columns.len() != rt.columns.len() {
            return true;
        }
        for (cc, rc) in ct.columns.iter().zip(rt.columns.iter()) {
            if cc.name != rc.name || cc.data_type != rc.data_type || cc.is_primary_key != rc.is_primary_key {
                return true;
            }
        }
    }

    false
}

#[tauri::command]
pub async fn scan_codebase(
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<ScanResult, String> {
    // Single-lock (key, schema) snapshot — keeps us consistent against a
    // concurrent connect.
    let (key, schema) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let key = inner
            .current_connection_key
            .clone()
            .ok_or("未连接到数据库".to_string())?;
        let schema = inner
            .schema_cache
            .get(&key)
            .cloned()
            .ok_or("请先刷新数据库结构".to_string())?;
        (key, schema)
    };

    let table_names: Vec<String> = schema.tables.iter().map(|t| t.name.clone()).collect();

    // `scan_directory` walks the entire tree reading every Go/TS/Prisma
    // file — this is a long blocking call, must run on a blocking thread.
    let mut result = tokio::task::spawn_blocking({
        let table_names = table_names.clone();
        move || scanner::scan_directory(&dir_path, &table_names)
    })
    .await
    .map_err(|e| format!("后台任务执行失败: {}", e))??;

    let cache_path = state.cache_db_path.clone();
    let key_for_disk = key.clone();
    let db_name = schema.database_name.clone();
    let descriptions = result.descriptions.clone();
    tokio::task::spawn_blocking(move || {
        persist::save_column_descriptions(&cache_path, &key_for_disk, &db_name, &descriptions)
    })
    .await
    .map_err(|e| format!("后台任务执行失败: {}", e))??;

    let cache_path = state.cache_db_path.clone();
    let key_for_disk = key.clone();
    result.descriptions = tokio::task::spawn_blocking(move || {
        persist::load_all_column_descriptions(&cache_path, &key_for_disk)
    })
    .await
    .map_err(|e| format!("后台任务执行失败: {}", e))??;

    Ok(result)
}

#[tauri::command]
pub async fn get_column_descriptions(
    table_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnDescription>, String> {
    let key = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner
            .current_connection_key
            .clone()
            .ok_or("未连接到数据库".to_string())?
    };

    let db_name = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner
            .schema_cache
            .get(&key)
            .map(|s| s.database_name.clone())
            .unwrap_or_default()
    };

    let cache_path = state.cache_db_path.clone();
    let key_for_disk = key.clone();
    let table_for_disk = table_name.clone();
    tokio::task::spawn_blocking(move || {
        persist::load_column_descriptions(&cache_path, &key_for_disk, &db_name, &table_for_disk)
    })
    .await
    .map_err(|e| format!("后台任务执行失败: {}", e))?
}