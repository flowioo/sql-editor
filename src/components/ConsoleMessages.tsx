import type { StatementResult } from "../hooks/useQuery";

interface ConsoleMessagesProps {
  readonly results: readonly StatementResult[];
}

function truncateSql(sql: string, maxLen = 35): string {
  const cleaned = sql.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "…";
}

export function ConsoleMessages({ results }: ConsoleMessagesProps) {
  // Show DML/DDL results (is_query=false)
  const nonQueryResults = results.filter((r) => !r.is_query);

  if (nonQueryResults.length === 0) return null;

  return (
    <div className="console-messages">
      {nonQueryResults.map((r, i) => {
        const truncated = truncateSql(r.sql);
        return (
          <div key={i} className="console-entry">
            <div className="console-sql">&gt; {truncated}</div>
            <div className="console-result">
              {r.error ? (
                <span className="console-error">
                  <span className="console-error-icon">x</span>
                  {r.error}
                </span>
              ) : (
                <span className="console-success">
                  影响 {r.affected_rows} 行
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
