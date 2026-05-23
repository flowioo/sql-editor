use tauri::State;
use crate::AppState;
use crate::schema::DatabaseSchema;
use crate::schema::scanner::{self, ColumnDescription, ScanResult};
use crate::schema::persist;

#[tauri::command]
pub fn refresh_schema(state: State<'_, AppState>) -> Result<DatabaseSchema, String> {
    let (driver, key) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let driver = inner.driver.clone().ok_or("未连接到数据库".to_string())?;
        let key = inner.current_connection_key.clone().ok_or("未连接到数据库".to_string())?;
        (driver, key)
    };

    let schema = driver.get_schema()?;

    persist::save_schema(&state.cache_db_path, &key, &schema)?;

    {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, schema.clone());
    }

    Ok(schema)
}

#[tauri::command]
pub fn get_cached_schema(state: State<'_, AppState>) -> Result<Option<DatabaseSchema>, String> {
    let (key, cached) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let key = inner.current_connection_key.clone()
            .ok_or("未连接到数据库".to_string())?;
        let cached = inner.schema_cache.get(&key).cloned();
        (key, cached)
    };

    if let Some(schema) = cached {
        return Ok(Some(schema));
    }

    let schema = persist::load_schema(&state.cache_db_path, &key)?;
    if let Some(ref s) = schema {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, s.clone());
    }

    Ok(schema)
}

/// Diff remote schema with cached schema. Returns (has_changes, current_schema).
/// If no cached schema exists, always returns (true, remote_schema).
#[tauri::command]
pub fn diff_schema(state: State<'_, AppState>) -> Result<SchemaDiffResult, String> {
    let (driver, key) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let driver = inner.driver.clone().ok_or("未连接到数据库".to_string())?;
        let key = inner.current_connection_key.clone().ok_or("未连接到数据库".to_string())?;
        (driver, key)
    };

    let remote_schema = driver.get_schema()?;
    let cached_schema = persist::load_schema(&state.cache_db_path, &key)?;

    let has_changes = match &cached_schema {
        None => true,
        Some(cached) => schema_changed(cached, &remote_schema),
    };

    if has_changes {
        persist::save_schema(&state.cache_db_path, &key, &remote_schema)?;
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, remote_schema.clone());
    }

    Ok(SchemaDiffResult {
        has_changes,
        schema: remote_schema,
    })
}

#[derive(serde::Serialize)]
pub struct SchemaDiffResult {
    pub has_changes: bool,
    pub schema: DatabaseSchema,
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
pub fn scan_codebase(
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<ScanResult, String> {
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
    let mut result = scanner::scan_directory(&dir_path, &table_names)?;

    persist::save_column_descriptions(
        &state.cache_db_path,
        &key,
        &schema.database_name,
        &result.descriptions,
    )?;

    result.descriptions = persist::load_all_column_descriptions(&state.cache_db_path, &key)?;

    Ok(result)
}

#[tauri::command]
pub fn get_column_descriptions(
    table_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnDescription>, String> {
    let (key, schema) = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let key = inner
            .current_connection_key
            .clone()
            .ok_or("未连接到数据库".to_string())?;
        let schema = inner
            .schema_cache
            .get(&key)
            .cloned();
        (key, schema)
    };

    let db_name = schema
        .as_ref()
        .map(|s| s.database_name.as_str())
        .unwrap_or("");

    persist::load_column_descriptions(&state.cache_db_path, &key, db_name, &table_name)
}
