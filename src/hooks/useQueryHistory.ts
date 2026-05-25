import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface QueryHistoryEntry {
  readonly id: string;
  readonly sql: string;
  readonly executedAt: string;
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

const STORAGE_KEY = "sql-editor-query-history";
const MAX_HISTORY = 200;

function loadHistory(): readonly QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueryHistoryEntry[];
    return parsed.slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(entries: readonly QueryHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // storage full — ignore
  }
}

async function saveSQLFile(sql: string, executedAt: string): Promise<string | undefined> {
  try {
    const d = new Date(executedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    // Generate a preview slug from the SQL
    const slug = sql
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 30)
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const filename = `${ts}_${slug}.sql`;
    const path = await invoke<string>("save_query_file", { filename, content: sql });
    return path;
  } catch {
    return undefined;
  }
}

export interface UseQueryHistoryReturn {
  readonly history: readonly QueryHistoryEntry[];
  readonly savedFiles: readonly QueryFileInfo[];
  readonly addEntry: (entry: Omit<QueryHistoryEntry, "id">) => void;
  readonly clearHistory: () => void;
  readonly loadFileContent: (filename: string) => Promise<string>;
  readonly refreshFiles: () => void;
}

export function useQueryHistory(): UseQueryHistoryReturn {
  const [history, setHistory] = useState<readonly QueryHistoryEntry[]>(loadHistory);
  const [savedFiles, setSavedFiles] = useState<readonly QueryFileInfo[]>([]);

  const refreshFiles = useCallback(() => {
    invoke<QueryFileInfo[]>("list_query_files").then(setSavedFiles).catch(() => {});
  }, []);

  // Load saved files on mount
  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const addEntry = useCallback((entry: Omit<QueryHistoryEntry, "id">) => {
    const id = crypto.randomUUID();
    const newEntry: QueryHistoryEntry = { ...entry, id };

    setHistory((prev) => {
      const next = [newEntry, ...prev].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });

    // Save to .sql file in background
    saveSQLFile(entry.sql, entry.executedAt).then((path) => {
      if (path) {
        refreshFiles();
      }
    });
  }, [refreshFiles]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const loadFileContent = useCallback(async (filename: string): Promise<string> => {
    return invoke<string>("read_query_file", { filename });
  }, []);

  return { history, savedFiles, addEntry, clearHistory, loadFileContent, refreshFiles };
}
