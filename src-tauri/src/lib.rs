use std::sync::Mutex;
use tauri::Manager;
use db::DatabaseDriver;
use schema::cache::SchemaCache;

mod commands;
mod db;
mod schema;

/// Single Mutex protecting all mutable state — eliminates deadlock risk
/// and ensures atomic state transitions.
pub struct InnerState {
    pub driver: Option<Box<dyn DatabaseDriver>>,
    pub schema_cache: SchemaCache,
    pub current_connection_key: Option<String>,
}

pub struct AppState {
    pub inner: Mutex<InnerState>,
    pub cache_db_path: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let cache_db_path = app_data_dir
                .join("schema_cache.db")
                .to_string_lossy()
                .to_string();

            schema::persist::ensure_cache_db(&cache_db_path)?;

            app.manage(AppState {
                inner: Mutex::new(InnerState {
                    driver: None,
                    schema_cache: SchemaCache::new(),
                    current_connection_key: None,
                }),
                cache_db_path,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect_sqlite,
            commands::connection::disconnect,
            commands::connection::test_connection,
            commands::query::execute_query,
            commands::schema::refresh_schema,
            commands::schema::get_cached_schema,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
