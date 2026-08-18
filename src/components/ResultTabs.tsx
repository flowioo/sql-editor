import { useState, memo } from "react";
import type { StatementResult } from "../hooks/useQuery";
import type { DatabaseSchema } from "../hooks/useSchema";
import type { SqlDialect } from "../lib/schema-source";
import { ResultGrid } from "./ResultGrid";
import { JsonRenderer } from "./results/JsonRenderer";
import { Tooltip, DropdownMenu } from "./ui";
import { useSettings } from "../hooks/useSettings";
import { listRenderers } from "./results/types";

interface ResultTabsProps {
  readonly results: readonly StatementResult[];
  readonly totalDurationMs: number;
  /** Database schema forwarded to ResultGrid for inline-edit PK/column
   *  resolution. */
  readonly schema: DatabaseSchema | null;
  /** SQL dialect forwarded to ResultGrid for correct identifier quoting and
   *  string escaping in generated UPDATE statements. */
  readonly dialect?: SqlDialect;
  /** Forwarded to the active ResultGrid so inline edits can submit a batch
   *  of UPDATE statements (one per row with staged changes). */
  readonly onSubmitUpdate?: (sqls: readonly string[], changeCount: number) => void;
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

export const ResultTabs = memo(function ResultTabs({
  results,
  totalDurationMs,
  schema,
  dialect,
  onSubmitUpdate,
}: ResultTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { settings, update: updateSettings } = useSettings();

  // Only show SELECT (is_query=true) results
  const queryResults = results.filter((r) => r.is_query);

  if (queryResults.length === 0) return null;

  // Reset activeIndex if it goes out of bounds
  const safeIndex = Math.min(activeIndex, queryResults.length - 1);
  const activeResult = queryResults[safeIndex];

  const renderers = listRenderers();
  const currentRenderer = renderers.find((r) => r.id === settings.resultView) ?? renderers[0];

  return (
    <div className="result-container">
      <div className="result-tabs-header">
        <div className="result-tabs-bar">
          {queryResults.map((r, i) => {
            const label = `结果 ${i + 1}`;
            return (
              <Tooltip key={i} content={tabLabel(r, i)}>
                <button
                  className={`result-tab ${i === safeIndex ? "result-tab-active" : ""}`}
                  onClick={() => setActiveIndex(i)}
                >
                  {label}
                </button>
              </Tooltip>
            );
          })}
        </div>
        <div className="result-tabs-actions">
          <DropdownMenu.Root>
            <Tooltip content="切换结果视图">
              <DropdownMenu.Trigger asChild>
                <button className="result-tab result-view-trigger">
                  {currentRenderer?.label ?? "表格"}
                </button>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="ui-dropdown-content" sideOffset={4} align="end">
                {renderers.map((r) => (
                  <DropdownMenu.Item
                    key={r.id}
                    className="ui-dropdown-item"
                    onSelect={() => updateSettings("resultView", r.id)}
                  >
                    {r.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <span className="result-tabs-duration">
            {totalDurationMs}ms
          </span>
        </div>
      </div>
      {activeResult && currentRenderer?.id === "table" && (
        <ResultGrid result={activeResult} schema={schema} dialect={dialect} onSubmitUpdate={onSubmitUpdate} />
      )}
      {activeResult && currentRenderer?.id === "json" && (
        <JsonRenderer result={activeResult} dialect={dialect} onSubmitUpdate={onSubmitUpdate} />
      )}
    </div>
  );
});
