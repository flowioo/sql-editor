import { invoke } from "@tauri-apps/api/core";

/**
 * OS-keychain-backed password storage. Passwords never enter localStorage —
 * the frontend keeps only passwordless connection metadata and calls these
 * helpers to attach/detach the real password around `connect`.
 *
 * The `id` is the SavedConnection.id; the backend stores under the
 * `com.sqleditor.app` keychain service.
 */

/** Persist a database password to the OS keychain under the connection id. */
export async function storePassword(id: string, password: string): Promise<void> {
  await invoke("store_password", { id, password });
}

/** Load a password from the OS keychain. Returns null if none stored
 *  (e.g. SQLite connections, or a pre-migration legacy connection). */
export async function loadPassword(id: string): Promise<string | null> {
  return invoke<string | null>("load_password", { id });
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
