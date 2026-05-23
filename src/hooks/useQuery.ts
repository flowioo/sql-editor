import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly affected_rows: number;
  readonly truncated: boolean;
}

interface QueryBatchPayload {
  readonly query_id: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly batch_index: number;
}

interface QueryCompletePayload {
  readonly query_id: string;
  readonly total_rows: number;
  readonly affected_rows: number;
  readonly truncated: boolean;
}

interface QueryErrorPayload {
  readonly query_id: string;
  readonly error: string;
}

export interface UseQueryReturn {
  readonly result: QueryResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly execute: (sql: string) => Promise<QueryResult | null>;
  readonly clear: () => void;
}

export function useQuery(): UseQueryReturn {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (sql: string): Promise<QueryResult | null> => {
    if (!sql.trim()) return null;
    setLoading(true);
    setError(null);

    const queryId = crypto.randomUUID();
    let columns: readonly string[] = [];
    let allRows: readonly (readonly (string | null)[])[] = [];
    let accumulated: QueryResult | null = null;

    const unlisteners: UnlistenFn[] = [];

    try {
      unlisteners.push(
        await listen<QueryBatchPayload>("query-batch", (event) => {
          if (event.payload.query_id !== queryId) return;
          if (event.payload.batch_index === 0) {
            columns = event.payload.columns;
          }
          allRows = [...allRows, ...event.payload.rows];
          accumulated = {
            columns,
            rows: allRows,
            affected_rows: 0,
            truncated: false,
          };
          setResult(accumulated);
        }),
      );

      unlisteners.push(
        await listen<QueryCompletePayload>("query-complete", (event) => {
          if (event.payload.query_id !== queryId) return;
          setResult({
            columns,
            rows: allRows,
            affected_rows: event.payload.affected_rows,
            truncated: event.payload.truncated,
          });
        }),
      );

      unlisteners.push(
        await listen<QueryErrorPayload>("query-error", (event) => {
          if (event.payload.query_id !== queryId) return;
          setError(event.payload.error);
        }),
      );

      await invoke("execute_query", { queryId, sql });
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
      for (const fn of unlisteners) fn();
    }

    return accumulated;
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, execute, clear };
}
