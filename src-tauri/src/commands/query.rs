use tauri::State;
use crate::AppState;
use crate::db::MultiQueryResult;

#[tauri::command]
pub async fn execute_query(
    sql: String,
    state: State<'_, AppState>,
) -> Result<MultiQueryResult, String> {
    let driver = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.driver.as_ref()
            .ok_or("未连接到数据库".to_string())?
            .clone()  // Driver is Clone via Arc
    };

    driver.execute_multi_query(&sql).await
}
