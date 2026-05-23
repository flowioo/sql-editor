import type { QueryResult } from "../hooks/useQuery";
import "../styles/result-grid.css";

interface ResultGridProps {
  readonly result: QueryResult;
}

export function ResultGrid({ result }: ResultGridProps) {
  const { columns, rows, affected_rows, truncated } = result;

  return (
    <div className="result-container">
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
            ) : (
              rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={cell === null ? "cell-null" : ""}>
                      {cell ?? "NULL"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
