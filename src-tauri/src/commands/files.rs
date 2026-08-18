use std::fs;
use tauri::Manager;

/// Convert a SavedConnection.id into a safe directory segment.
/// PostgreSQL/MySQL ids look like `postgresql://u@h:5432/db` — we replace
/// unsafe chars with `_`. Empty string is mapped to `unassigned`.
pub fn sanitize_conn_id(id: &str) -> String {
    if id.is_empty() {
        return "unassigned".to_string();
    }
    let cleaned: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // Trim leading underscores produced by `://`
    let trimmed = cleaned.trim_start_matches('_').to_string();
    if trimmed.is_empty() {
        "unassigned".to_string()
    } else {
        trimmed
    }
}

/// Validate that a user-supplied filename is a single safe path component.
///
/// Rejects empty names, NUL bytes, path separators (`/`, `\`), traversal
/// segments (`.`/`..`), and Windows drive prefixes (`C:`). A filename that
/// passes this check cannot escape its containing directory via lexical
/// traversal — this is the primary defense against path traversal via the
/// `filename` argument coming from the frontend.
fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("文件名不能为空".to_string());
    }
    if filename.contains('\0') {
        return Err("文件名包含非法字符".to_string());
    }
    if filename.contains('/') || filename.contains('\\') {
        return Err("文件名不能包含路径分隔符".to_string());
    }
    let trimmed = filename.trim();
    if trimmed == "." || trimmed == ".." {
        return Err("非法文件名".to_string());
    }
    // Reject Windows drive-prefixed names like "C:foo".
    let mut chars = filename.chars();
    if let Some(first) = chars.next() {
        if first.is_ascii_alphabetic() && chars.next() == Some(':') {
            return Err("非法文件名".to_string());
        }
    }
    Ok(())
}

/// Join `dir` with a validated `filename`, and — when the target already
/// exists — additionally verify (via canonicalize) that it stays under `dir`.
/// The canonicalize check is defense-in-depth on top of the lexical
/// `validate_filename`; it catches symlink escape should the conn dir ever
/// contain attacker-placed links.
fn safe_join(dir: &std::path::Path, filename: &str) -> Result<std::path::PathBuf, String> {
    validate_filename(filename)?;
    let joined = dir.join(filename);
    if joined.exists() {
        let canon_base = dir.canonicalize().map_err(|e| format!("无法解析目录: {}", e))?;
        let canon_target =
            joined.canonicalize().map_err(|e| format!("无法解析文件路径: {}", e))?;
        if !canon_target.starts_with(&canon_base) {
            return Err("文件路径越界".to_string());
        }
        Ok(canon_target)
    } else {
        Ok(joined)
    }
}

fn queries_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("queries");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn conn_dir(app: &tauri::AppHandle, connection_id: &str) -> Result<std::path::PathBuf, String> {
    let dir = queries_root(app)?.join(sanitize_conn_id(connection_id));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Run an fs-touching closure on a blocking thread so it does not stall
/// the Tokio worker. The closure is moved into the blocking task, never
/// invoked on the runtime thread.
async fn run_blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("后台任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn save_query_file(
    app: tauri::AppHandle,
    connection_id: String,
    filename: String,
    content: String,
) -> Result<String, String> {
    let dir = conn_dir(&app, &connection_id)?;
    run_blocking(move || {
        let path = safe_join(&dir, &filename)?;
        fs::write(&path, &content).map_err(|e| format!("写入文件失败: {}", e))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn read_query_file(
    app: tauri::AppHandle,
    connection_id: String,
    filename: String,
) -> Result<String, String> {
    let dir = conn_dir(&app, &connection_id)?;
    run_blocking(move || {
        let path = safe_join(&dir, &filename)?;
        fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
    })
    .await
}

#[tauri::command]
pub async fn list_query_files(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Vec<QueryFileInfo>, String> {
    let dir = conn_dir(&app, &connection_id)?;
    run_blocking(move || Ok(collect_sql_files(&dir))).await
}

#[tauri::command]
pub async fn delete_query_file(
    app: tauri::AppHandle,
    connection_id: String,
    filename: String,
) -> Result<(), String> {
    let dir = conn_dir(&app, &connection_id)?;
    run_blocking(move || {
        let path = safe_join(&dir, &filename)?;
        fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))
    })
    .await
}

/// Diagnostic: list every saved .sql file across all connection folders.
#[tauri::command]
pub async fn list_all_query_files(app: tauri::AppHandle) -> Result<Vec<QueryFileInfo>, String> {
    let root = queries_root(&app)?;
    run_blocking(move || -> Result<Vec<QueryFileInfo>, String> {
        let mut out = Vec::new();
        let entries = match fs::read_dir(&root) {
            Ok(e) => e,
            Err(_) => return Ok(out),
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                out.extend(collect_sql_files(&p));
            } else if p.extension().and_then(|s| s.to_str()) == Some("sql") {
                if let Some(info) = file_info(&p) {
                    out.push(info);
                }
            }
        }
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)
    })
    .await
}

/// One-shot migration: move flat .sql files at `queries/*.sql` into
/// `queries/unassigned/`. Safe to call repeatedly; no-op if already migrated.
pub fn migrate_flat_files_to_unassigned(app: &tauri::AppHandle) -> Result<(), String> {
    let root = queries_root(app)?;
    let target = root.join("unassigned");
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("sql") {
            if let Some(name) = p.file_name() {
                let dest = target.join(name);
                if !dest.exists() {
                    fs::rename(&p, &dest).map_err(|e| format!("迁移文件失败: {}", e))?;
                }
            }
        }
    }
    Ok(())
}

/// One-shot migration: strip the legacy `:***` segment from connection keys
/// stored in the schema cache. Prior versions embedded a redacted-password
/// marker into connection_key; the current format omits it, so without this
/// migration upgraded users would silently lose their cached schema. Safe to
/// call repeatedly — no-op once no legacy keys remain.
///
/// Multiple legacy rows (e.g. snapshots taken under different passwords) can
/// collapse onto the same `(connection_key, db_name)` once `:***` is stripped,
/// which would trip the `UNIQUE(connection_key, db_name)` constraint on
/// `schema_snapshots` (and the 4-column one on `column_descriptions`). We
/// dedupe **before** the UPDATE: keep the most recent snapshot per
/// `(new_key, db_name)`, and the row with the highest id for each column
/// description tuple. Anything older is dropped — the schema will be
/// re-introspected on next connect, and column descriptions are restored from
/// the surviving row.
pub fn migrate_connection_keys(app: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let cache_db = app_data_dir.join("schema_cache.db");
    if !cache_db.exists() {
        return Ok(());
    }
    let mut conn = rusqlite::Connection::open(&cache_db)
        .map_err(|e| format!("迁移缓存失败: {}", e))?;

    let tx = conn.transaction().map_err(|e| format!("迁移缓存失败: {}", e))?;

    // 1a. Drop legacy `schema_snapshots` rows whose post-REPLACE key collides
    //     with an already-migrated row. Without this, the UPDATE below trips
    //     the UNIQUE(connection_key, db_name) constraint — which is exactly
    //     what was panicking startup.
    tx.execute_batch(
        "DELETE FROM schema_snapshots \
         WHERE id IN ( \
             SELECT legacy.id \
             FROM schema_snapshots AS legacy \
             JOIN schema_snapshots AS fresh \
               ON fresh.id != legacy.id \
              AND fresh.connection_key NOT LIKE '%:***%' \
              AND fresh.connection_key = REPLACE(legacy.connection_key, ':***', '') \
              AND fresh.db_name = legacy.db_name \
             WHERE legacy.connection_key LIKE '%:***%' \
         ); \
         \
         DELETE FROM column_descriptions \
         WHERE id IN ( \
             SELECT legacy.id \
             FROM column_descriptions AS legacy \
             JOIN column_descriptions AS fresh \
               ON fresh.id != legacy.id \
              AND fresh.connection_key NOT LIKE '%:***%' \
              AND fresh.connection_key = REPLACE(legacy.connection_key, ':***', '') \
              AND fresh.db_name = legacy.db_name \
              AND fresh.table_name = legacy.table_name \
              AND fresh.column_name = legacy.column_name \
             WHERE legacy.connection_key LIKE '%:***%' \
         );",
    )
    .map_err(|e| format!("迁移缓存失败: {}", e))?;

    // 1b. Within remaining legacy rows, dedupe per (new_key, db_name) keeping
    //     the most recent snapshot (column_descriptions: keep highest id).
    tx.execute_batch(
        "DELETE FROM schema_snapshots \
         WHERE id IN ( \
             SELECT id FROM ( \
                 SELECT id, ROW_NUMBER() OVER ( \
                     PARTITION BY REPLACE(connection_key, ':***', ''), db_name \
                     ORDER BY captured_at DESC, id DESC \
                 ) AS rn \
                 FROM schema_snapshots \
                 WHERE connection_key LIKE '%:***%' \
             ) WHERE rn > 1 \
         ); \
         \
         DELETE FROM column_descriptions \
         WHERE id IN ( \
             SELECT id FROM ( \
                 SELECT id, ROW_NUMBER() OVER ( \
                     PARTITION BY REPLACE(connection_key, ':***', ''), \
                                  db_name, table_name, column_name \
                     ORDER BY id DESC \
                 ) AS rn \
                 FROM column_descriptions \
                 WHERE connection_key LIKE '%:***%' \
             ) WHERE rn > 1 \
         );",
    )
    .map_err(|e| format!("迁移缓存失败: {}", e))?;

    // 2. Now safe to strip the legacy `:***` placeholder.
    tx.execute_batch(
        "UPDATE schema_snapshots \
            SET connection_key = REPLACE(connection_key, ':***', '') \
          WHERE connection_key LIKE '%:***%'; \
         UPDATE column_descriptions \
            SET connection_key = REPLACE(connection_key, ':***', '') \
          WHERE connection_key LIKE '%:***%';",
    )
    .map_err(|e| format!("迁移缓存失败: {}", e))?;

    tx.commit().map_err(|e| format!("迁移缓存失败: {}", e))?;
    Ok(())
}

fn collect_sql_files(dir: &std::path::Path) -> Vec<QueryFileInfo> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut out: Vec<QueryFileInfo> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()? != "sql" {
                return None;
            }
            file_info(&path)
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

fn file_info(path: &std::path::Path) -> Option<QueryFileInfo> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    let filename = path.file_name()?.to_string_lossy().to_string();
    let size = metadata.len();
    Some(QueryFileInfo {
        filename,
        modified,
        size,
    })
}

#[derive(serde::Serialize, Clone)]
pub struct QueryFileInfo {
    pub filename: String,
    pub modified: u64,
    pub size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_conn_id_replaces_unsafe() {
        assert_eq!(
            sanitize_conn_id("postgresql://u@h:5432/db"),
            "postgresql___u_h_5432_db"
        );
        assert_eq!(sanitize_conn_id("sqlite"), "sqlite");
        assert_eq!(sanitize_conn_id(""), "unassigned");
        assert_eq!(sanitize_conn_id("://"), "unassigned");
        assert_eq!(sanitize_conn_id("///"), "unassigned");
    }

    #[test]
    fn validate_filename_accepts_normal_names() {
        assert!(validate_filename("query1.sql").is_ok());
        assert!(validate_filename("my query.sql").is_ok());
        assert!(validate_filename("查询.sql").is_ok());
        assert!(validate_filename("a-b_c.sql").is_ok());
    }

    #[test]
    fn validate_filename_rejects_traversal() {
        assert!(validate_filename("").is_err());
        assert!(validate_filename("..").is_err());
        assert!(validate_filename(".").is_err());
        // Path separators are rejected outright.
        assert!(validate_filename("../evil.sql").is_err());
        assert!(validate_filename("a/b.sql").is_err());
        assert!(validate_filename("a\\b.sql").is_err());
        // NUL byte.
        assert!(validate_filename("a\0b.sql").is_err());
        // Windows drive prefix.
        assert!(validate_filename("C:evil.sql").is_err());
    }
}