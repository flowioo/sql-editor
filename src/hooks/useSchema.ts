import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Column {
  readonly name: string;
  readonly data_type: string;
  readonly nullable: boolean;
  readonly default_value: string | null;
  readonly is_primary_key: boolean;
}

export interface Table {
  readonly name: string;
  readonly columns: readonly Column[];
}

export interface DatabaseSchema {
  readonly database_name: string;
  readonly tables: readonly Table[];
  readonly captured_at: string;
}

export interface UseSchemaReturn {
  readonly schema: DatabaseSchema | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadFromCache: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useSchema(): UseSchemaReturn {
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFromCache = useCallback(async () => {
    try {
      const cached = await invoke<DatabaseSchema | null>("get_cached_schema");
      if (cached) {
        setSchema(cached);
        setError(null);
      }
    } catch {
      // ignore — no cache available
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DatabaseSchema>("refresh_schema");
      setSchema(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { schema, loading, error, loadFromCache, refresh };
}
