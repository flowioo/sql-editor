import { useState } from "react";
import type { StatementResult } from "../hooks/useQuery";
import { ResultGrid } from "./ResultGrid";

interface ResultTabsProps {
  readonly results: readonly StatementResult[];
  readonly totalDurationMs: number;
  /** Forwarded to the active ResultGrid so inline edits can submit a batch
   *  of UPDATE statements (one per row with staged changes). */
  readonly onSubmitUpdate?: (sqls: readonly string[]) => void;
}

const MAX_TAB_LABEL_LENGTH = 25;

function tabLabel(result: StatementResult, index: number): string {
  // Try to extract a short preview from the SQL
  const sqlPreview = result.sql
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAB_LABEL_LENGTH);
  return `结果 ${index + 1}: ${sqlPreview}${result.sql.trim().length > MAX_TAB_LABEL_LENGTH ? "…" : ""}`;
}

export function ResultTabs({
  results,
  totalDurationMs,
  onSubmitUpdate,
}: ResultTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  // Only show SELECT (is_query=true) results
  const queryResults = results.filter((r) => r.is_query);

  if (queryResults.length === 0) return null;

  // Reset activeIndex if it goes out of bounds
  const safeIndex = Math.min(activeIndex, queryResults.length - 1);
  const activeResult = queryResults[safeIndex];

  return (
    <div className="result-container">
      <div className="result-tabs-header">
        <div className="result-tabs-bar">
          {queryResults.map((r, i) => {
            const label = `结果 ${i + 1}`;
            return (
              <button
                key={i}
                className={`result-tab ${i === safeIndex ? "result-tab-active" : ""}`}
                onClick={() => setActiveIndex(i)}
                title={tabLabel(r, i)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span className="result-tabs-duration">
          {totalDurationMs}ms
        </span>
      </div>
      {activeResult && (
        <ResultGrid result={activeResult} onSubmitUpdate={onSubmitUpdate} />
      )}
    </div>
  );
}
