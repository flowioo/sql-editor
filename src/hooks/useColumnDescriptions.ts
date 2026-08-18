import { useState, useCallback } from "react";
import { call } from "../lib/ipc";

export interface ColumnDescription {
  readonly table_name: string;
  readonly column_name: string;
  readonly description: string;
  readonly source: string;
  readonly file_path: string;
}

/** Per-table load status used by callers to throttle retries / surface
 *  failures. We track success/failure rather than blanket-swallow. */
export interface ColumnDescriptionState {
  readonly loading: boolean;
  readonly error: string | null;
}

export interface UseColumnDescriptionsReturn {
  readonly descriptions: ReadonlyMap<string, string>;
  readonly states: ReadonlyMap<string, ColumnDescriptionState>;
  readonly loadDescriptions: (tableName: string) => Promise<void>;
}

export function useColumnDescriptions(): UseColumnDescriptionsReturn {
  const [descriptions, setDescriptions] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [states, setStates] = useState<ReadonlyMap<string, ColumnDescriptionState>>(
    new Map(),
  );

  const loadDescriptions = useCallback(async (tableName: string) => {
    setStates((prev) => {
      const next = new Map(prev);
      next.set(tableName, { loading: true, error: null });
      return next;
    });
    try {
      const result = await call<ColumnDescription[]>(
        "get_column_descriptions",
        { tableName },
      );
      setDescriptions((prev) => {
        const next = new Map(prev);
        for (const d of result) {
          next.set(`${d.table_name}.${d.column_name}`, d.description);
        }
        return next;
      });
      setStates((prev) => {
        const next = new Map(prev);
        next.set(tableName, { loading: false, error: null });
        return next;
      });
    } catch (e) {
      // Surface the failure so the caller can decide to toast / log; the
      // previous map is preserved so already-loaded descriptions stay visible.
      const msg = String(e);
      setStates((prev) => {
        const next = new Map(prev);
        next.set(tableName, { loading: false, error: msg });
        return next;
      });
    }
  }, []);

  return { descriptions, states, loadDescriptions };
}
