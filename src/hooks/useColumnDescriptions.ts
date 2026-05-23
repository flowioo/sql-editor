import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ColumnDescription {
  readonly table_name: string;
  readonly column_name: string;
  readonly description: string;
  readonly source: string;
  readonly file_path: string;
}

export interface UseColumnDescriptionsReturn {
  readonly descriptions: ReadonlyMap<string, string>;
  readonly loadDescriptions: (tableName: string) => Promise<void>;
}

export function useColumnDescriptions(): UseColumnDescriptionsReturn {
  const [descriptions, setDescriptions] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  const loadDescriptions = useCallback(async (tableName: string) => {
    try {
      const result = await invoke<ColumnDescription[]>(
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
    } catch {
      // ignore — descriptions not available
    }
  }, []);

  return { descriptions, loadDescriptions };
}
