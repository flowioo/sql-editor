import { useState } from "react";
import type { DatabaseSchema } from "../hooks/useSchema";
import type { QueryHistoryEntry, QueryFileInfo } from "../hooks/useQueryHistory";
import {
  loadSavedConnections,
  removeSavedConnection,
  type SavedConnection,
} from "./ConnectionDialog";
import { SchemaTree } from "./SchemaTree";
import "../styles/sidebar.css";

type SidebarTabKey = "connections" | "schema" | "history" | "files";

interface SidebarProps {
  readonly schema: DatabaseSchema | null;
  readonly lastRefreshedAt: string | null;
  readonly offline: boolean;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly history: readonly QueryHistoryEntry[];
  readonly savedFiles: readonly QueryFileInfo[];
  readonly currentConnectionId: string | null;
  readonly onHistorySelect: (sql: string) => void;
  readonly onFileOpen: (filename: string) => void;
  readonly onClearHistory: () => void;
  readonly onConnect: (config: import("../types/connection").ConnectionConfig) => void;
  readonly onNewConnection: () => void;
  readonly onTableSelect?: (tableName: string) => void;
  readonly onTableStructure?: (tableName: string) => void;
}

const TAB_LABELS: Record<SidebarTabKey, string> = {
  connections: "连接",
  schema: "数据库",
  history: "历史",
  files: "文件",
};

export function Sidebar({
  schema,
  lastRefreshedAt,
  offline,
  descriptions,
  history,
  savedFiles,
  currentConnectionId,
  onHistorySelect,
  onFileOpen,
  onClearHistory,
  onConnect,
  onNewConnection,
  onTableSelect,
  onTableStructure,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTabKey>("schema");
  const [savedList, setSavedList] = useState<SavedConnection[]>(loadSavedConnections);

  const refreshSaved = () => setSavedList(loadSavedConnections());

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
          <div className="connections-list">
            <div className="connections-header">
              <span>已保存 ({savedList.length})</span>
              <button className="conn-new-btn" onClick={onNewConnection}>
                新建
              </button>
            </div>
            {savedList.length === 0 ? (
              <div className="sidebar-placeholder">
                暂无已保存的连接
              </div>
            ) : (
              savedList.map((conn) => {
                const isActive = conn.id === currentConnectionId;
                return (
                  <div
                    key={conn.id}
                    className={`conn-item${isActive ? " active" : ""}`}
                  >
                    <span className={`conn-icon type-${conn.config.type}`}>
                      {conn.config.type === "sqlite"
                        ? "SQLite"
                        : conn.config.type === "postgresql"
                          ? "PG"
                          : conn.config.type === "mysql"
                            ? "MY"
                            : "RD"}
                    </span>
                    <div className="conn-info">
                      <span className="conn-name">{conn.name}</span>
                      <span className="conn-detail">
                        {conn.config.type === "sqlite"
                          ? conn.config.path
                          : `${conn.config.user}@${conn.config.host}:${conn.config.port}/${conn.config.database}`}
                      </span>
                    </div>
                    <div className="conn-actions">
                      <button
                        className="conn-action"
                        onClick={() => onConnect(conn.config)}
                        title="连接"
                      >
                        连接
                      </button>
                      <button
                        className="conn-action danger"
                        onClick={() => {
                          if (confirm(`确定要删除连接「${conn.name}」?`)) {
                            removeSavedConnection(conn.id);
                            refreshSaved();
                          }
                        }}
                        title="删除"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })
            )}
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
            <SchemaTree schema={schema} descriptions={descriptions} onTableSelect={onTableSelect} onTableStructure={onTableStructure} />
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

        {activeTab === "files" && (
          <div className="history-list">
            {savedFiles.length === 0 ? (
              <div className="sidebar-placeholder">
                执行查询后自动保存为 .sql 文件
              </div>
            ) : (
              <>
                <div className="history-header">
                  <span>{savedFiles.length} 个文件</span>
                </div>
                {savedFiles.map((file) => (
                  <FileItem
                    key={file.filename}
                    file={file}
                    onClick={() => onFileOpen(file.filename)}
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

function FileItem({
  file,
  onClick,
}: {
  readonly file: QueryFileInfo;
  readonly onClick: () => void;
}) {
  const timeStr = formatTimeMs(file.modified);
  const displayName = file.filename.replace(/^\d{8}_\d{6}_/, "").replace(/\.sql$/, "");
  const sizeStr = file.size > 1024 ? `${(file.size / 1024).toFixed(1)}K` : `${file.size}B`;

  return (
    <button className="history-item file-item" onClick={onClick}>
      <div className="history-item-preview">{displayName || file.filename}</div>
      <div className="history-item-meta">
        <span>{timeStr}</span>
        <span className="history-status ok">{sizeStr}</span>
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

function formatTimeMs(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ms);
  }
}
