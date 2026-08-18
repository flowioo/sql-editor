import type { ConnectionConfig } from "../types/connection";

/**
 * Stable id used to bucket history / files per connection.
 * Mirrors the scheme in src-tauri/src/commands/files.rs::sanitize_conn_id
 * so the localStorage connectionId and the Rust-side subdirectory line up.
 */
export function connIdFromConfig(c: ConnectionConfig): string {
  switch (c.type) {
    case "sqlite":
      return c.path;
    case "postgresql":
      return `postgresql://${c.user}@${c.host}:${c.port}/${c.database}`;
    case "mysql":
      return `mysql://${c.user}@${c.host}:${c.port}/${c.database}`;
    case "redis":
      return `redis://${c.host}:${c.port}/${c.database}`;
  }
}

/** Postgres / MySQL / SQLite map directly to the SQL dialect identifiers
 *  used by the renderer/grammar layer. Redis returns undefined — Redis
 *  has no SQL dialect, callers should fall back to a generic rendering. */
export function dialectOfConnection(c: ConnectionConfig | null | undefined):
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "redis"
  | undefined {
  if (!c) return undefined;
  return c.type;
}
