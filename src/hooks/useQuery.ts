import { useState, useCallback, useRef } from "react";
import { call } from "../lib/ipc";

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

export interface ExecuteOutcome {
  readonly result: MultiQueryResult | null;
  readonly error: string | null;
}

export interface UseQueryReturn {
  readonly result: MultiQueryResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly execute: (sql: string) => Promise<ExecuteOutcome>;
  readonly clear: () => void;
}

export function useQuery(): UseQueryReturn {
  const [result, setResult] = useState<MultiQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id — bumped for every execute() call. When a response
  // arrives, we compare its captured id to the current one and drop the
  // result if a newer request has started in the meantime. Prevents
  // out-of-order responses from clobbering the latest result.
  const requestIdRef = useRef(0);

  const execute = useCallback(async (sql: string): Promise<ExecuteOutcome> => {
    if (!sql.trim()) return { result: null, error: null };
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await call<MultiQueryResult>("execute_query", { sql });
      // If a newer request has been issued, drop this result.
      if (reqId !== requestIdRef.current) return { result: null, error: null };
      setResult(res);
      setError(null);
      return { result: res, error: null };
    } catch (e) {
      if (reqId !== requestIdRef.current) return { result: null, error: null };
      const msg = String(e);
      setError(msg);
      setResult(null);
      return { result: null, error: msg };
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, execute, clear };
}
