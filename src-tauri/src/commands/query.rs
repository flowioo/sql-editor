use tauri::State;
use crate::AppState;
use crate::db::QueryResult;

#[tauri::command]
pub async fn execute_query(
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let driver = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.driver.as_ref()
            .ok_or("未连接到数据库".to_string())?
            .clone()  // Driver is Clone via Arc
    };

    driver.execute_query(&sql).await
}
