import { useMemo } from "react";
import type { StatementResult } from "../hooks/useQuery";
import "../styles/result-grid.css";

interface ResultGridProps {
  readonly result: StatementResult;
}

const ROW_HEIGHT = 28;
const VISIBLE_ROWS = 50;

export function ResultGrid({ result }: ResultGridProps) {
  const { columns, rows, affected_rows, truncated } = result;

  const totalHeight = useMemo(() => rows.length * ROW_HEIGHT, [rows.length]);

  return (
    <>
      <div className="result-header">
        <span className="result-count">
          {rows.length === affected_rows
            ? `${rows.length} 行`
            : `${rows.length} 行 (影响 ${affected_rows} 行)`}
        </span>
        {truncated && (
          <span className="result-truncated">
            结果已截断，最多显示 {rows.length} 行
          </span>
        )}
      </div>
      <div className="result-scroll">
        <table className="result-grid">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="result-empty">
                  无数据
                </td>
              </tr>
            ) : rows.length <= VISIBLE_ROWS ? (
              rows.map((row, ri) => (
                <tr key={ri} style={{ height: ROW_HEIGHT }}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={cell === null ? "cell-null" : ""}>
                      {cell ?? "NULL"}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <VirtualizedRows
                rows={rows}
                columnCount={columns.length}
                totalHeight={totalHeight}
              />
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface VirtualizedRowsProps {
  readonly rows: readonly (readonly (string | null)[])[];
  readonly columnCount: number;
  readonly totalHeight: number;
}

function VirtualizedRows({ rows, columnCount, totalHeight }: VirtualizedRowsProps) {
  return (
    <tr>
      <td colSpan={columnCount} style={{ padding: 0 }}>
        <div
          className="virtual-scroll-viewport"
          style={{ height: VISIBLE_ROWS * ROW_HEIGHT, overflowY: "auto" }}
        >
          <div style={{ height: totalHeight, position: "relative" }}>
            <table className="result-grid virtual-table">
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ height: ROW_HEIGHT }}>
                    {row.map((cell, ci) => (
                      <td key={ci} className={cell === null ? "cell-null" : ""}>
                        {cell ?? "NULL"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}
