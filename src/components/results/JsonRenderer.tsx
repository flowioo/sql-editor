import { useMemo } from "react";
import type { StatementResult } from "../../hooks/useQuery";
import "./JsonRenderer.css";

interface JsonRendererProps {
  readonly result: StatementResult;
  readonly dialect?: string;
  readonly onSubmitUpdate?: (sqls: readonly string[], changeCount: number) => void;
}

/**
 * Read-only JSON view of a result. Useful for inspecting non-tabular
 * output (e.g. a single-cell result) or for quickly eyeballing the raw
 * shape without the column-by-column UI.
 */
export function JsonRenderer({ result }: JsonRendererProps) {
  const json = useMemo(() => {
    // Convert the rows→columns shape into a records array so we can render
    // one JSON object per row.
    const records = result.rows.map((row: readonly (string | null)[]) => {
      const obj: Record<string, string | null> = {};
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i] ?? ""] = row[i] ?? null;
      }
      return obj;
    });
    return JSON.stringify(records, null, 2);
  }, [result.columns, result.rows]);

  return (
    <div className="result-json">
      <pre className="result-json-pre">{json}</pre>
    </div>
  );
}
