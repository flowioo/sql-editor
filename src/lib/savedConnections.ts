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
    //
    // Only clone entries whose config actually changed: withStrippedUrl
    // returns the same reference when there is nothing to strip, so
    // reference equality doubles as the change signal. Cloning
    // unconditionally made the write-notify-listen-load cycle recurse
    // forever (each load "detected" a change and re-notified), freezing
    // the page with no console output — the errors were swallowed by this
    // very catch block.
    let changed = false;
    const migrated = list.map((c) => {
      const config = withStrippedUrl(c.config);
      if (config === c.config) return c;
      changed = true;
      return { ...c, config };
    });
    if (changed) writeSavedConnections(migrated, /* silent */ true);
    return migrated;
  } catch {
    return [];
  }
}

function writeSavedConnections(list: SavedConnection[], silent = false): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  // Silent writes are pure normalizations (e.g. the legacy-URL migration):
  // the logical data is unchanged, so listeners must not re-read — a notify
  // here fires listener setStates while a component may still be rendering
  // ("Cannot update a component while rendering a different component"),
  // and paired with a load that always "changes" it recursed forever.
  if (!silent) notify();
}

/** Return a copy of `config` whose `url` carries no embedded password.
 *  Returns the SAME reference when the url is already password-free —
 *  loadSavedConnections relies on reference equality as its change signal,
 *  so an unconditional clone here would make every load "change" and
 *  re-trigger the write→notify cycle. Unparseable URLs are dropped (we
 *  cannot strip what we cannot parse). */
function withStrippedUrl(config: ConnectionConfig): ConnectionConfig {
  if (!("url" in config) || !config.url) return config;
  try {
    const u = new URL(config.url);
    if (u.password === "") return config;
    u.password = "";
    return { ...config, url: u.toString() };
  } catch {
    return { ...config, url: undefined };
  }
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
