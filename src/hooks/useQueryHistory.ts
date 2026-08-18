import { useState, useCallback, useEffect } from "react";
import { call } from "../lib/ipc";

export interface QueryHistoryEntry {
  readonly id: string;
  readonly sql: string;
  readonly executedAt: string;
  /** SavedConnection.id of the connection that ran this query, or null if
   *  the query ran before this feature was added (v1 history entries). */
  readonly connectionId: string | null;
  /** Friendly display name of the connection — cached so deleting the
   *  connection later doesn't make old history entries lose their context. */
  readonly connectionName: string | null;
  readonly databaseName: string | null;
  readonly rowCount: number | null;
  readonly error: string | null;
  readonly filename?: string;
}

export interface QueryFileInfo {
  readonly filename: string;
  readonly modified: number;
  readonly size: number;
}

const STORAGE_KEY = "sql-editor-query-history-v2";
const STORAGE_KEY_V1 = "sql-editor-query-history";
const MAX_HISTORY = 100;

function loadHistory(): readonly QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QueryHistoryEntry[];
      return parsed.slice(0, MAX_HISTORY);
    }
    // v1 → v2 one-shot migration.
    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) {
      const parsed = JSON.parse(v1) as Array<{
        id: string;
        sql: string;
        executedAt: string;
        databaseName?: string | null;
        rowCount?: number | null;
        error?: string | null;
        filename?: string;
      }>;
      const migrated: QueryHistoryEntry[] = parsed.slice(0, MAX_HISTORY).map((e) => ({
        id: e.id,
        sql: e.sql,
        executedAt: e.executedAt,
        connectionId: null,
        connectionName: e.databaseName ?? null,
        databaseName: e.databaseName ?? null,
        rowCount: e.rowCount ?? null,
        error: e.error ?? null,
        filename: e.filename,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(STORAGE_KEY_V1);
      return migrated;
    }
    return [];
  } catch {
    return [];
  }
}

function saveHistory(entries: readonly QueryHistoryEntry[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_HISTORY)),
    );
  } catch {
    // storage full — ignore
  }
}

async function saveSQLFile(
  sql: string,
  executedAt: string,
  connectionId: string | null,
): Promise<string | undefined> {
  try {
    const d = new Date(executedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const slug = sql
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 30)
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const filename = `${ts}_${slug}.sql`;
    const path = await call<string>("save_query_file", {
      connectionId: connectionId ?? "",
      filename,
      content: sql,
    });
    return path;
  } catch {
    return undefined;
  }
}

export interface UseQueryHistoryReturn {
  readonly history: readonly QueryHistoryEntry[];
  readonly savedFiles: readonly QueryFileInfo[];
  readonly addEntry: (entry: Omit<QueryHistoryEntry, "id">) => void;
  readonly removeEntry: (id: string) => void;
  readonly clearHistory: () => void;
  readonly loadFileContent: (filename: string) => Promise<string>;
  readonly deleteFile: (filename: string) => Promise<void>;
  readonly refreshFiles: () => void;
  readonly saveCurrentAsFile: (sql: string) => Promise<string | undefined>;
}

export function useQueryHistory(
  currentConnectionId: string | null,
): UseQueryHistoryReturn {
  const [history, setHistory] = useState<readonly QueryHistoryEntry[]>(loadHistory);
  const [savedFiles, setSavedFiles] = useState<readonly QueryFileInfo[]>([]);

  const refreshFiles = useCallback(() => {
    const id = currentConnectionId ?? "";
    call<QueryFileInfo[]>("list_query_files", { connectionId: id })
      .then(setSavedFiles)
      .catch(() => {});
  }, [currentConnectionId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const addEntry = useCallback(
    (entry: Omit<QueryHistoryEntry, "id">) => {
      const id = crypto.randomUUID();
      const newEntry: QueryHistoryEntry = { ...entry, id };

      setHistory((prev) => {
        const next = [newEntry, ...prev].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
      // NOTE: We no longer auto-write a .sql file on every run — files are
      // opt-in via saveCurrentAsFile (called when the user opens a new
      // query window), so the per-connection file folder doesn't fill up
      // with one file per execution.
    },
    [],
  );

  /** Persist the given SQL as a `.sql` file in the current connection's
   *  queries folder. Called from App when the user opens a new query window
   *  via the toolbar `+` button (i.e. a deliberate "create query" gesture).
   *  Returns the saved filename, or undefined on failure. */
  const saveCurrentAsFile = useCallback(
    async (sql: string): Promise<string | undefined> => {
      if (!sql.trim()) return undefined;
      const executedAt = new Date().toISOString();
      const filename = await saveSQLFile(sql, executedAt, currentConnectionId);
      if (filename) refreshFiles();
      return filename;
    },
    [currentConnectionId, refreshFiles],
  );

  const removeEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const loadFileContent = useCallback(
    async (filename: string): Promise<string> => {
      return call<string>("read_query_file", {
        connectionId: currentConnectionId ?? "",
        filename,
      });
    },
    [currentConnectionId],
  );

  const deleteFile = useCallback(
    async (filename: string): Promise<void> => {
      await call("delete_query_file", {
        connectionId: currentConnectionId ?? "",
        filename,
      });
      refreshFiles();
    },
    [currentConnectionId, refreshFiles],
  );

  return {
    history,
    savedFiles,
    addEntry,
    removeEntry,
    clearHistory,
    loadFileContent,
    deleteFile,
    refreshFiles,
    saveCurrentAsFile,
  };
}
