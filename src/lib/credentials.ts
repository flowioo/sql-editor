import { invoke } from "@tauri-apps/api/core";

/**
 * OS-keychain-backed password storage. Passwords never enter localStorage —
 * the frontend keeps only passwordless connection metadata and calls these
 * helpers to attach/detach the real password around `connect`.
 *
 * The `id` is the SavedConnection.id; the backend stores under the
 * `com.sqleditor.app` keychain service.
 */

/** Reject with guidance when a keychain invoke has not settled in time.
 *
 *  Keychain ops normally finish in milliseconds, but macOS can raise a
 *  hidden authorization prompt when the item was created by a previous dev
 *  build (ad-hoc signatures change every rebuild). The invoke then pends
 *  until the user notices the dialog — surfacing guidance beats an
 *  indefinite "连接中...". */
const KEYCHAIN_TIMEOUT_MS = 15_000;

function withKeychainTimeout<T>(op: string, p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${op}系统密钥链超时（15 秒）。可能有一个 macOS 密钥串授权弹窗在等你确认——` +
                "请查看是否有被遮挡的系统对话框（可尝试移动应用窗口），输入登录密码并选择「始终允许」。",
            ),
          ),
        KEYCHAIN_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** Persist a database password to the OS keychain under the connection id. */
export async function storePassword(id: string, password: string): Promise<void> {
  await withKeychainTimeout("写入", invoke("store_password", { id, password }));
}

/** Load a password from the OS keychain. Returns null if none stored
 *  (e.g. SQLite connections, or a pre-migration legacy connection). */
export async function loadPassword(id: string): Promise<string | null> {
  return withKeychainTimeout("读取", invoke<string | null>("load_password", { id }));
}

/** Remove a password from the OS keychain. Silently succeeds if absent. */
export async function deletePassword(id: string): Promise<void> {
  await invoke("delete_password", { id });
}

/** A saved connection as persisted in localStorage (passwordless config + id). */
export interface SavedConnectionRef {
  readonly id: string;
  readonly config: import("../types/connection").ConnectionConfig;
}

/** Re-attach the password from the OS keychain to a saved connection's
 *  config, returning a fully-materialized config ready for `connect`.
 *  SQLite connections have no password and pass through unchanged.
 *
 *  Legacy fallback: pre-keyring versions stored the plaintext password in
 *  localStorage. If the keychain has no entry yet we use that stale value so
 *  upgraded users can still connect; it is wiped on the next save. */
export async function materializeConfig(conn: SavedConnectionRef): Promise<import("../types/connection").ConnectionConfig> {
  if (conn.config.type === "sqlite") return conn.config;
  const pwd = await loadPassword(conn.id).catch(() => null);
  const password = pwd ?? conn.config.password ?? "";
  // The persisted copy has credentials stripped from `url`; the backend's
  // URL branch parses `url` directly, so re-embed the password here. SQLite
  // and Redis configs carry no `url` field and use fields only.
  if ("url" in conn.config && conn.config.url) {
    try {
      const u = new URL(conn.config.url);
      u.password = password;
      return { ...conn.config, password, url: u.toString() };
    } catch { /* unparseable url — fall through to field-only config */ }
  }
  return { ...conn.config, password };
}
