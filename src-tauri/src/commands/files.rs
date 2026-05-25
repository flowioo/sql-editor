use std::fs;
use tauri::Manager;

#[tauri::command]
pub fn save_query_file(app: tauri::AppHandle, filename: String, content: String) -> Result<String, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("queries");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(&filename);
    fs::write(&path, &content).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_query_file(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("queries")
        .join(&filename);

    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub fn list_query_files(app: tauri::AppHandle) -> Result<Vec<QueryFileInfo>, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("queries");

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut files: Vec<QueryFileInfo> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()? != "sql" {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata.modified().ok()?
                .duration_since(std::time::UNIX_EPOCH).ok()?
                .as_millis() as u64;
            let filename = path.file_name()?.to_string_lossy().to_string();
            let size = metadata.len();
            Some(QueryFileInfo { filename, modified, size })
        })
        .collect();

    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

#[derive(serde::Serialize, Clone)]
pub struct QueryFileInfo {
    pub filename: String,
    pub modified: u64,
    pub size: u64,
}
