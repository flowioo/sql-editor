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

#[tauri::command]
pub fn save_query_file(
    app: tauri::AppHandle,
    connection_id: String,
    filename: String,
    content: String,
) -> Result<String, String> {
    let dir = conn_dir(&app, &connection_id)?;
    let path = dir.join(&filename);
    fs::write(&path, &content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_query_file(
    app: tauri::AppHandle,
    connection_id: String,
    filename: String,
) -> Result<String, String> {
    let path = conn_dir(&app, &connection_id)?.join(&filename);
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub fn list_query_files(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Vec<QueryFileInfo>, String> {
    let dir = conn_dir(&app, &connection_id)?;
    Ok(collect_sql_files(&dir))
}

#[tauri::command]
pub fn delete_query_file(
    app: tauri::AppHandle,
    connection_id: String,
    filename: String,
) -> Result<(), String> {
    let path = conn_dir(&app, &connection_id)?.join(&filename);
    fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))
}

/// Diagnostic: list every saved .sql file across all connection folders.
#[tauri::command]
pub fn list_all_query_files(app: tauri::AppHandle) -> Result<Vec<QueryFileInfo>, String> {
    let root = queries_root(&app)?;
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
        assert_eq!(
            sanitize_conn_id("redis://:pwd@host:6379/3"),
            "redis____pwd_host_6379_3"
        );
    }
}