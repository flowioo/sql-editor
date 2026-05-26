import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface StatementResult {
  readonly sql: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly affected_rows: number;
  readonly truncated: boolean;
  readonly is_query: boolean;
  readonly error?: string | null;
}

export interface MultiQueryResult {
  readonly results: readonly StatementResult[];
  readonly total_duration_ms: number;
}

export interface UseQueryReturn {
  readonly result: MultiQueryResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly execute: (sql: string) => Promise<MultiQueryResult | null>;
  readonly clear: () => void;
}

export function useQuery(): UseQueryReturn {
  const [result, setResult] = useState<MultiQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (sql: string): Promise<MultiQueryResult | null> => {
    if (!sql.trim()) return null;
    setLoading(true);
    setError(null);

    try {
      const res = await invoke<MultiQueryResult>("execute_query", { sql });
      setResult(res);
      return res;
    } catch (e) {
      setError(String(e));
      setResult(null);
      return null;
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
