import { useState } from "react";
import type { DatabaseSchema } from "../hooks/useSchema";
import type { QueryHistoryEntry } from "../hooks/useQueryHistory";
import { SchemaTree } from "./SchemaTree";
import "../styles/sidebar.css";

type SidebarTabKey = "connections" | "schema" | "history";

interface SidebarProps {
  readonly schema: DatabaseSchema | null;
  readonly lastRefreshedAt: string | null;
  readonly offline: boolean;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly history: readonly QueryHistoryEntry[];
  readonly onHistorySelect: (sql: string) => void;
  readonly onClearHistory: () => void;
  readonly onTableSelect?: (tableName: string) => void;
}

const TAB_LABELS: Record<SidebarTabKey, string> = {
  connections: "连接",
  schema: "数据库",
  history: "历史",
};

export function Sidebar({
  schema,
  lastRefreshedAt,
  offline,
  descriptions,
  history,
  onHistorySelect,
  onClearHistory,
  onTableSelect,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTabKey>("schema");

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        {(Object.keys(TAB_LABELS) as SidebarTabKey[]).map((key) => (
          <button
            key={key}
            className={`sidebar-tab${activeTab === key ? " active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="sidebar-content">
        {activeTab === "connections" && (
          <div className="sidebar-placeholder">
            点击工具栏「连接」按钮配置数据库连接
          </div>
        )}

        {activeTab === "schema" && (
          <>
            {lastRefreshedAt && (
              <div className="schema-meta">
                <span className="schema-refresh-time">
                  {offline ? "离线模式" : "上次刷新"}: {formatTime(lastRefreshedAt)}
                </span>
                {offline && <span className="offline-badge">离线</span>}
              </div>
            )}
            <SchemaTree schema={schema} descriptions={descriptions} onTableSelect={onTableSelect} />
          </>
        )}

        {activeTab === "history" && (
          <div className="history-list">
            {history.length === 0 ? (
              <div className="sidebar-placeholder">
                查询历史将在运行查询后显示
              </div>
            ) : (
              <>
                <div className="history-header">
                  <span>{history.length} 条记录</span>
                  <button className="history-clear" onClick={onClearHistory}>
                    清空
                  </button>
                </div>
                {history.map((entry) => (
                  <HistoryItem
                    key={entry.id}
                    entry={entry}
                    onClick={() => onHistorySelect(entry.sql)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function HistoryItem({
  entry,
  onClick,
}: {
  readonly entry: QueryHistoryEntry;
  readonly onClick: () => void;
}) {
  const preview = entry.sql.replace(/\n/g, " ").slice(0, 60);
  const timeStr = formatTime(entry.executedAt);

  return (
    <button className="history-item" onClick={onClick}>
      <div className="history-item-preview">{preview}</div>
      <div className="history-item-meta">
        <span>{timeStr}</span>
        {entry.error ? (
          <span className="history-status error">失败</span>
        ) : entry.rowCount !== null ? (
          <span className="history-status ok">{entry.rowCount} 行</span>
        ) : null}
      </div>
    </button>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
