use std::sync::Arc;
use tauri::State;
use crate::AppState;
use crate::application::ports::DriverGateway;
use crate::db::sqlite::SqliteDriver;
use crate::db::postgres::PostgresDriver;
use crate::db::mysql::MySqlDriver;
use crate::db::redis::RedisDriver;
use crate::db::ConnectionConfig;
use crate::schema::persist;

#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let conn_key = config.connection_key();
    let display_name = config.display_name();

    // Build the driver first. If it fails, drop any previous driver so the
    // next query cannot silently run against the old connection (fail-closed).
    let driver = match build_driver(&config).await {
        Ok(d) => d,
        Err(e) => {
            let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
            inner.driver = None;
            inner.current_connection_key = None;
            inner.schema_cache.clear();
            return Err(e);
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

/// Construct a Driver from a ConnectionConfig. Shared by `connect` and
/// `test_connection_cmd`. Performs the actual connection so auth/network
/// errors surface here; credentials are passed via per-driver ConnectOptions
/// builders (never embedded in a URL string), and errors are classified so
/// the connection string/password never reaches the frontend.
async fn build_driver(config: &ConnectionConfig) -> Result<Arc<dyn DriverGateway>, String> {
    let driver: Arc<dyn DriverGateway> = match config {
        ConnectionConfig::Sqlite { path } => {
            let d = SqliteDriver::new(path)?;
            d.test_connection()?;
            Arc::new(d)
        }
        ConnectionConfig::Postgresql { host, port, user, password, database, url } => {
            let d = PostgresDriver::new(host, *port, user, password, database, url.as_deref()).await?;
            Arc::new(d)
        }
        ConnectionConfig::Mysql { host, port, user, password, database, url } => {
            let d = MySqlDriver::new(host, *port, user, password, database, url.as_deref()).await?;
            Arc::new(d)
        }
        ConnectionConfig::Redis { host, port, password, database } => {
            let d = RedisDriver::new(host, *port, password, *database).await?;
            Arc::new(d)
        }
    };
    Ok(driver)
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
    build_driver(&config).await.map(|_| ())
}
