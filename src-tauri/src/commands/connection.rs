use tauri::State;
use crate::AppState;
use crate::db::sqlite::SqliteDriver;
use crate::db::DatabaseDriver;
use crate::schema::persist;

#[tauri::command]
pub fn connect_sqlite(path: String, state: State<'_, AppState>) -> Result<String, String> {
    // Create and test driver outside the lock
    let driver = SqliteDriver::new(&path)?;
    driver.test_connection()?;

    let display_name = std::path::Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Load cached schema from disk (outside the lock — read-only on cache_db)
    let cached_schema = persist::load_schema(&state.cache_db_path, &path)?;

    // Single lock acquisition — atomic state update
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.driver = Some(Box::new(driver));
    inner.current_connection_key = Some(path.clone());
    if let Some(s) = cached_schema {
        inner.schema_cache.set(path, s);
    }

    Ok(display_name)
}

#[tauri::command]
pub fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.driver = None;
    inner.current_connection_key = None;
    inner.schema_cache.clear();
    Ok(())
}

#[tauri::command]
pub fn test_connection(path: String) -> Result<(), String> {
    let driver = SqliteDriver::new(&path)?;
    driver.test_connection()
}
