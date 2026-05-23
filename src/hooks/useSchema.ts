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

interface DiffResult {
  readonly has_changes: boolean;
  readonly schema: DatabaseSchema;
}

export interface UseSchemaReturn {
  readonly schema: DatabaseSchema | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly lastRefreshedAt: string | null;
  readonly offline: boolean;
  readonly loadFromCache: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly diffOnConnect: () => Promise<void>;
}

export function useSchema(): UseSchemaReturn {
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const loadFromCache = useCallback(async () => {
    try {
      const cached = await invoke<DatabaseSchema | null>("get_cached_schema");
      if (cached) {
        setSchema(cached);
        setLastRefreshedAt(cached.captured_at);
        setError(null);
      }
    } catch {
      // ignore — no cache available
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setOffline(false);
    setError(null);
    try {
      const result = await invoke<DatabaseSchema>("refresh_schema");
      setSchema(result);
      setLastRefreshedAt(result.captured_at);
    } catch (e) {
      setError(String(e));
      // Try loading from cache as fallback (offline mode)
      try {
        const cached = await invoke<DatabaseSchema | null>("get_cached_schema");
        if (cached) {
          setSchema(cached);
          setOffline(true);
        }
      } catch {
        // give up
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const diffOnConnect = useCallback(async () => {
    setLoading(true);
    setOffline(false);
    setError(null);
    try {
      const diff = await invoke<DiffResult>("diff_schema");
      setSchema(diff.schema);
      setLastRefreshedAt(diff.schema.captured_at);
    } catch (e) {
      setError(String(e));
      // Offline fallback — load from cache only
      try {
        const cached = await invoke<DatabaseSchema | null>("get_cached_schema");
        if (cached) {
          setSchema(cached);
          setOffline(true);
        }
      } catch {
        // give up
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    schema,
    loading,
    error,
    lastRefreshedAt,
    offline,
    loadFromCache,
    refresh,
    diffOnConnect,
  };
}
