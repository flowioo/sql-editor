use std::sync::{Arc, Mutex};
use tauri::Manager;
use application::ports::DriverGateway;
use schema::cache::SchemaCache;

pub mod application;
mod commands;
mod credentials;
pub mod db;
pub mod domain;
pub mod schema;

pub struct InnerState {
    pub driver: Option<Arc<dyn DriverGateway>>,
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

            // Cache is best-effort: a corrupted cache must not prevent the
            // app from starting. Log + continue; cache reads/writes will
            // report failures at the call site and the user keeps full
            // functionality against the live database.
            if let Err(e) = schema::persist::ensure_cache_db(&cache_db_path) {
                eprintln!("[startup] 缓存数据库初始化失败，缓存功能将不可用: {}", e);
            }

            // One-shot migration of pre-per-connection flat .sql files —
            // also best-effort (file moves on disk can fail under sandbox
            // restrictions without breaking app launch).
            if let Err(e) = commands::files::migrate_flat_files_to_unassigned(app.handle()) {
                eprintln!("[startup] 迁移旧查询文件失败: {}", e);
            }
            // One-shot migration: strip legacy `:***` from cached
            // connection keys — same best-effort posture as the file
            // migration.
            if let Err(e) = commands::files::migrate_connection_keys(app.handle()) {
                eprintln!("[startup] 迁移缓存键失败: {}", e);
            }

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
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::test_connection_cmd,
            commands::query::execute_query,
            commands::schema::refresh_schema,
            commands::schema::get_cached_schema,
            commands::schema::diff_schema,
            commands::schema::scan_codebase,
            commands::schema::get_column_descriptions,
            commands::files::save_query_file,
            commands::files::read_query_file,
            commands::files::list_query_files,
            commands::files::delete_query_file,
            commands::files::list_all_query_files,
            credentials::store_password,
            credentials::load_password,
            credentials::delete_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
