use tauri::State;
use crate::AppState;
use crate::schema::DatabaseSchema;
use crate::schema::persist;

#[tauri::command]
pub fn refresh_schema(state: State<'_, AppState>) -> Result<DatabaseSchema, String> {
    let schema = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let driver = inner.driver.as_ref().ok_or("未连接到数据库".to_string())?;
        driver.get_schema()?
    };

    let key = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.current_connection_key.clone().ok_or("未连接到数据库".to_string())?
    };

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

    // Fall back to persistent cache
    let schema = persist::load_schema(&state.cache_db_path, &key)?;
    if let Some(ref s) = schema {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.schema_cache.set(key, s.clone());
    }

    Ok(schema)
}
