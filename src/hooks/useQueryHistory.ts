import { useState, useCallback } from "react";

export interface QueryHistoryEntry {
  readonly id: string;
  readonly sql: string;
  readonly executedAt: string;
  readonly databaseName: string | null;
  readonly rowCount: number | null;
  readonly error: string | null;
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

export interface UseQueryHistoryReturn {
  readonly history: readonly QueryHistoryEntry[];
  readonly addEntry: (entry: Omit<QueryHistoryEntry, "id">) => void;
  readonly clearHistory: () => void;
}

export function useQueryHistory(): UseQueryHistoryReturn {
  const [history, setHistory] = useState<readonly QueryHistoryEntry[]>(loadHistory);

  const addEntry = useCallback((entry: Omit<QueryHistoryEntry, "id">) => {
    const newEntry: QueryHistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
    };
    setHistory((prev) => {
      const next = [newEntry, ...prev].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { history, addEntry, clearHistory };
}
