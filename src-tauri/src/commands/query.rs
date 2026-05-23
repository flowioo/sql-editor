use std::sync::Arc;
use tauri::{State, Emitter, AppHandle};
use crate::AppState;
use crate::db::{DatabaseDriver, QueryBatchEvent, QueryCompleteEvent, QueryErrorEvent};

const BATCH_SIZE: usize = 1000;

#[tauri::command]
pub async fn execute_query(
    query_id: String,
    sql: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let driver: Arc<dyn DatabaseDriver> = {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.driver.clone().ok_or("未连接到数据库".to_string())?
    };

    let result = match driver.execute_query(&sql) {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit("query-error", QueryErrorEvent {
                query_id,
                error: e.clone(),
            });
            return Err(e);
        }
    };

    let columns = result.columns.clone();
    let total_rows = result.rows.len();

    // Emit results in batches of BATCH_SIZE
    for (i, chunk) in result.rows.chunks(BATCH_SIZE).enumerate() {
        app.emit("query-batch", QueryBatchEvent {
            query_id: query_id.clone(),
            columns: if i == 0 { columns.clone() } else { vec![] },
            rows: chunk.to_vec(),
            batch_index: i as u32,
        }).map_err(|e| e.to_string())?;
    }

    app.emit("query-complete", QueryCompleteEvent {
        query_id,
        total_rows: total_rows as u64,
        affected_rows: result.affected_rows,
        truncated: result.truncated,
    }).map_err(|e| e.to_string())?;

    Ok(())
}
