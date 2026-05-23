use std::sync::Arc;
use tauri::State;
use crate::AppState;
use crate::db::sqlite::SqliteDriver;
use crate::db::postgres::PostgresDriver;
use crate::db::mysql::MySqlDriver;
use crate::db::{ConnectionConfig, DatabaseDriver};
use crate::schema::persist;

#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let conn_key = config.connection_key();
    let display_name = config.display_name();

    // Create and test driver
    let driver: Arc<dyn DatabaseDriver> = match &config {
        ConnectionConfig::Sqlite { path } => {
            let d = SqliteDriver::new(path)?;
            d.test_connection()?;
            Arc::new(d)
        }
        ConnectionConfig::Postgresql { host, port, user, password, database } => {
            let d = PostgresDriver::new(host, *port, user, password, database).await?;
            d.test_connection()?;
            Arc::new(d)
        }
        ConnectionConfig::Mysql { host, port, user, password, database } => {
            let d = MySqlDriver::new(host, *port, user, password, database).await?;
            d.test_connection()?;
            Arc::new(d)
        }
    };

    // Load cached schema from disk
    let cached_schema = persist::load_schema(&state.cache_db_path, &conn_key)?;

    // Atomic state update
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.driver = Some(driver);
    inner.current_connection_key = Some(conn_key.clone());
    if let Some(s) = cached_schema {
        inner.schema_cache.set(conn_key, s);
    }

    Ok(display_name)
}

// Keep connect_sqlite for backward compatibility
#[tauri::command]
pub fn connect_sqlite(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let driver = SqliteDriver::new(&path)?;
    driver.test_connection()?;

    let display_name = std::path::Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let cached_schema = persist::load_schema(&state.cache_db_path, &path)?;

    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.driver = Some(std::sync::Arc::new(driver));
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
pub async fn test_connection_cmd(config: ConnectionConfig) -> Result<(), String> {
    match &config {
        ConnectionConfig::Sqlite { path } => {
            let driver = SqliteDriver::new(path)?;
            driver.test_connection()
        }
        ConnectionConfig::Postgresql { host, port, user, password, database } => {
            let driver = PostgresDriver::new(host, *port, user, password, database).await?;
            driver.test_connection()
        }
        ConnectionConfig::Mysql { host, port, user, password, database } => {
            let driver = MySqlDriver::new(host, *port, user, password, database).await?;
            driver.test_connection()
        }
    }
}
