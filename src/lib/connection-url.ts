import type { ConnectionConfig } from "../types/connection";

/**
 * Parse a database URL string into a ConnectionConfig. Supports the three
 * protocols with URL-shaped fields: postgresql://, mysql://, redis://.
 * Returns null when the URL is malformed or the protocol is not supported.
 *
 * The full URL (including the password) is preserved on the returned config
 * for PG/MySQL — callers may then store the password in the keychain and
 * strip it from the persisted copy.
 */
export function parseDatabaseUrl(url: string): ConnectionConfig | null {
  try {
    const u = new URL(url);
    const type = u.protocol.replace(":", "") as "postgresql" | "mysql" | "redis";
    if (type !== "postgresql" && type !== "mysql" && type !== "redis") return null;
    const password = decodeURIComponent(u.password || "");
    const database = u.pathname.replace(/^\//, "").split("?")[0];
    if (!u.hostname) return null;
    if (type === "redis") {
      // redis://:password@host:6379/0 — db index defaults to 0, username unused.
      const dbIndex = Number(database) || 0;
      return {
        type,
        host: u.hostname,
        port: u.port ? Number(u.port) : 6379,
        password,
        database: dbIndex,
      };
    }
    if (!database) return null;
    return {
      type,
      host: u.hostname,
      port: u.port ? Number(u.port) : type === "postgresql" ? 5432 : 3306,
      user: decodeURIComponent(u.username || ""),
      password,
      database,
      url,
    };
  } catch {
    return null;
  }
}

/** Default display name for a connection when the user hasn't supplied an
 *  alias. SQLite uses the filename; PG/MySQL use database@host; Redis uses
 *  the database index. */
export function makeDefaultName(config: ConnectionConfig): string {
  switch (config.type) {
    case "sqlite":
      return config.path.split("/").pop() || config.path;
    case "postgresql":
    case "mysql":
      return `${config.database} (${config.host})`;
    case "redis":
      return `redis db${config.database} (${config.host})`;
  }
}
