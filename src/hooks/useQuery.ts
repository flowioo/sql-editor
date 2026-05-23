import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly affected_rows: number;
  readonly truncated: boolean;
}

export interface UseQueryReturn {
  readonly result: QueryResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly execute: (sql: string) => Promise<void>;
  readonly clear: () => void;
}

export function useQuery(): UseQueryReturn {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (sql: string) => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const queryResult = await invoke<QueryResult>("execute_query", { sql });
      setResult(queryResult);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, execute, clear };
}
