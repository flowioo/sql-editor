import type { ConnectionConfig } from "../types/connection";
import {
  loadPassword,
  storePassword,
  deletePassword,
} from "./credentials";

/**
 * Saved-connection persistence — single source of truth.
 *
 * localStorage carries only the passwordless metadata (id + name + a copy
 * of the config with credentials blanked). The real password lives in the
 * OS keychain keyed by `id` via the helpers in `lib/credentials.ts`.
 *
 * Migration: older builds embedded the plaintext password inside the
 * connection's `url` field. We strip it on every load so the next save
 * is clean; the password itself is preserved (when present) so the user
 * can still connect on the next session.
 */

const STORAGE_KEY = "sql-editor-saved-connections";

export interface SavedConnection {
  readonly id: string;
  readonly name: string;
  readonly config: ConnectionConfig;
}

type Listener = () => void;
const listeners: Set<Listener> = new Set();

/** Subscribe to changes (save/rename/duplicate/remove). Returns the
 *  unsubscribe function. Used by Sidebar/ConnectionDialog so they re-read
 *  the list automatically instead of relying on a manual version counter. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function loadSavedConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: SavedConnection[] = JSON.parse(raw);
    // Migration: URLs persisted by older builds embedded the plaintext
    // password; strip them in place. `password` is deliberately left
    // untouched here — materializeConfig's legacy fallback may rely on it.
    const migrated = list.map((c) => ({ ...c, config: withStrippedUrl(c.config) }));
    if (migrated.some((c, i) => c !== list[i])) writeSavedConnections(migrated);
    return migrated;
  } catch {
    return [];
  }
}

function writeSavedConnections(list: SavedConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  notify();
}

/** Rebuild `url` without its embedded password section; returns undefined
 *  when the URL cannot be parsed (we then drop it rather than risk keeping
 *  credentials). Used before anything reaches localStorage. */
function stripUrlPassword(url: string): string | undefined {
  try {
    const u = new URL(url);
    u.password = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Return a copy of `config` whose `url` carries no embedded password.
 *  Objects are returned unchanged when there is nothing to strip (SQLite
 *  and Redis configs have no `url` field at all). */
function withStrippedUrl(config: ConnectionConfig): ConnectionConfig {
  if (!("url" in config) || !config.url) return config;
  return { ...config, url: stripUrlPassword(config.url) };
}

/** Return a copy of `config` with all credentials blanked — both the
 *  `password` field and any password embedded in `url`. This passwordless
 *  copy is what we persist to localStorage; the real password lives only in
 *  the OS keychain (keyed by SavedConnection.id). */
function stripPassword(config: ConnectionConfig): ConnectionConfig {
  if (config.type === "sqlite") return config;
  return withStrippedUrl({ ...config, password: "" });
}

/** Persist a connection: store the real password in the OS keychain (keyed
 *  by id) and a passwordless copy of the config in localStorage. */
export async function saveConnection(conn: SavedConnection): Promise<void> {
  if (conn.config.type !== "sqlite") {
    await storePassword(conn.id, conn.config.password);
  }
  const list = loadSavedConnections();
  const idx = list.findIndex((c) => c.id === conn.id);
  const meta: SavedConnection = { ...conn, config: stripPassword(conn.config) };
  if (idx >= 0) {
    list[idx] = meta;
  } else {
    list.push(meta);
  }
  writeSavedConnections(list);
}

/** Update the displayed name of an existing saved connection by id. */
export function renameSavedConnection(id: string, name: string): void {
  const list = loadSavedConnections();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], name: name.trim() || list[idx].name };
  writeSavedConnections(list);
}

/** Duplicate a saved connection under a new id, copying the keychain
 *  password if one exists. Returns the new entry. */
export async function duplicateSavedConnection(id: string): Promise<SavedConnection | null> {
  const list = loadSavedConnections();
  const src = list.find((c) => c.id === id);
  if (!src) return null;
  const newId = `${src.id}__copy_${Date.now()}`;
  const pwd = await loadPassword(id).catch(() => null);
  if (pwd) {
    await storePassword(newId, pwd).catch(() => {});
  }
  const newConn: SavedConnection = {
    id: newId,
    name: `${src.name} (副本)`,
    config: src.config,
  };
  list.push(newConn);
  writeSavedConnections(list);
  return newConn;
}

/** Remove a saved connection: delete its keychain password and the
 *  localStorage metadata entry. */
export async function removeSavedConnection(id: string): Promise<void> {
  await deletePassword(id).catch(() => {});
  const list = loadSavedConnections().filter((c) => c.id !== id);
  writeSavedConnections(list);
}
