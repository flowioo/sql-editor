//! Database credential storage backed by the OS keychain.
//!
//! Passwords are stored via the `keyring` crate (macOS Keychain /
//! Windows Credential Manager / Linux libsecret) and are **never** written to
//! localStorage or to plaintext files. The frontend keeps only
//! passwordless connection metadata; before connecting it calls
//! `load_password` to materialize the real password into the in-memory
//! `ConnectionConfig` that is passed to `connect`.

use keyring::Entry;

/// OS keychain service name under which all SQL Editor DB passwords are
/// stored. The account/key is the SavedConnection id.
const SERVICE: &str = "com.sqleditor.app";

#[tauri::command]
pub async fn store_password(id: String, password: String) -> Result<(), String> {
    // Keychain calls are blocking and, on macOS, the first access from an
    // unsigned dev build can raise a system authorization prompt — a modal
    // session. A synchronous Tauri command runs on the main thread, so that
    // prompt would freeze the whole WebView (symptom: dialog stuck, UI
    // unresponsive, zero console output). Run on the blocking pool instead.
    tauri::async_runtime::spawn_blocking(move || {
        Entry::new(SERVICE, &id)
            .map_err(|e| format!("无法访问系统密钥链: {}", e))?
            .set_password(&password)
            .map_err(|e| format!("保存密码到密钥链失败: {}", e))
    })
    .await
    .map_err(|e| format!("密钥链任务执行失败: {}", e))?
}

/// Load a stored password. Returns `None` when no entry exists for `id`
/// (e.g. SQLite connections, or a pre-migration legacy connection).
#[tauri::command]
pub async fn load_password(id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &id)
            .map_err(|e| format!("无法访问系统密钥链: {}", e))?;
        match entry.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("从密钥链读取密码失败: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("密钥链任务执行失败: {}", e))?
}

/// Delete a stored password. No-op (Ok) when the entry does not exist.
#[tauri::command]
pub async fn delete_password(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &id)
            .map_err(|e| format!("无法访问系统密钥链: {}", e))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("从密钥链删除密码失败: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("密钥链任务执行失败: {}", e))?
}
