import { useState, useEffect, useMemo, memo } from "react";
import type { DatabaseSchema } from "../hooks/useSchema";
import type { QueryHistoryEntry, QueryFileInfo } from "../hooks/useQueryHistory";
import {
  loadSavedConnections,
  removeSavedConnection,
  duplicateSavedConnection,
  subscribe as subscribeSavedConnections,
  type SavedConnection,
} from "../lib/savedConnections";
import { DB_TYPE_ICON_LABEL } from "../lib/tokens";
import { SchemaTree } from "./SchemaTree";
import { Tooltip, DropdownMenu } from "./ui";
import { useConfirm } from "../hooks/useConfirm";
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
  readonly activeFilename: string | null;
  readonly onHistorySelect: (sql: string) => void;
  readonly onHistoryRemove: (id: string) => void;
  readonly onFileOpen: (filename: string) => void;
  readonly onFileDelete: (filename: string) => void;
  readonly onClearHistory: () => void;
  readonly onConnect: (conn: SavedConnection) => void;
  readonly onNewConnection: () => void;
  readonly onEditConnection: (conn: SavedConnection) => void;
  readonly onTableSelect?: (tableName: string) => void;
  readonly onTableStructure?: (tableName: string) => void;
}

const TAB_LABELS: Record<SidebarTabKey, string> = {
  connections: "连接",
  schema: "数据库",
  history: "历史",
  files: "文件",
};

/** Sidebar renders inline lists for connections / schema / history / files.
 *  Wrapped in React.memo so the heavy schema tree doesn't re-render when
 *  the parent (App) re-renders for unrelated reasons (e.g. a query result
 *  arrived). */
export const Sidebar = memo(function Sidebar({
  schema,
  lastRefreshedAt,
  offline,
  descriptions,
  history,
  savedFiles,
  currentConnectionId,
  activeFilename,
  onHistorySelect,
  onHistoryRemove,
  onFileOpen,
  onFileDelete,
  onClearHistory,
  onConnect,
  onNewConnection,
  onEditConnection,
  onTableSelect,
  onTableStructure,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTabKey>("schema");
  const [savedList, setSavedList] = useState<SavedConnection[]>(loadSavedConnections);
  const [historyFilter, setHistoryFilter] = useState("");
  const [filesFilter, setFilesFilter] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Subscribe to the saved-connection store so renames / deletes / duplicates
  // (from ConnectionDialog or another Sidebar) refresh this list automatically.
  useEffect(() => subscribeSavedConnections(() => setSavedList(loadSavedConnections())), []);

  // Reset filters when switching tabs.
  useEffect(() => {
    setHistoryFilter("");
    setFilesFilter("");
  }, [activeTab]);

  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return history;
    return history.filter((e) => {
      if (e.sql.toLowerCase().includes(q)) return true;
      if (e.connectionName?.toLowerCase().includes(q)) return true;
      if (e.databaseName?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [history, historyFilter]);

  const filteredFiles = useMemo(() => {
    const q = filesFilter.trim().toLowerCase();
    if (!q) return savedFiles;
    return savedFiles.filter((f) => f.filename.toLowerCase().includes(q));
  }, [savedFiles, filesFilter]);

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
              <div className="sidebar-placeholder">暂无已保存的连接</div>
            ) : (
              savedList.map((conn) => {
                const isActive = conn.id === currentConnectionId;
                return (
                  <div
                    key={conn.id}
                    className={`conn-item${isActive ? " active" : ""}`}
                  >
                    <span className={`conn-icon type-${conn.config.type}`}>
                      {DB_TYPE_ICON_LABEL[conn.config.type] ?? "?"}
                    </span>
                    <div className="conn-info">
                      <span className="conn-name">{conn.name}</span>
                      <span className="conn-detail">
                        {conn.config.type === "sqlite"
                          ? conn.config.path
                          : conn.config.type === "redis"
                            ? `${conn.config.host}:${conn.config.port}/db${conn.config.database}`
                            : `${conn.config.user}@${conn.config.host}:${conn.config.port}/${conn.config.database}`}
                      </span>
                    </div>
                    <div className="conn-actions">
                      <DropdownMenu.Root>
                        <Tooltip content="连接操作">
                          <DropdownMenu.Trigger asChild>
                            <button
                              className="conn-action conn-action-menu"
                              aria-label={`连接操作：${conn.name}`}
                            >
                              ⋯
                            </button>
                          </DropdownMenu.Trigger>
                        </Tooltip>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            className="ui-dropdown-content"
                            sideOffset={4}
                            align="end"
                          >
                            <DropdownMenu.Item
                              className="ui-dropdown-item"
                              onSelect={() => onConnect(conn)}
                            >
                              连接
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="ui-dropdown-item"
                              onSelect={() => onEditConnection(conn)}
                            >
                              编辑
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="ui-dropdown-item"
                              onSelect={async () => {
                                // duplicateSavedConnection copies the keychain
                                // password under a new id; the subscribe listener
                                // above refreshes the list automatically.
                                await duplicateSavedConnection(conn.id);
                              }}
                            >
                              复制
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="ui-dropdown-separator" />
                            <DropdownMenu.Item
                              className="ui-dropdown-item danger"
                              onSelect={async () => {
                                const ok = await confirm({
                                  title: "删除连接",
                                  description: `确定要删除连接「${conn.name}」?`,
                                  confirmLabel: "删除",
                                  variant: "danger",
                                });
                                if (ok) await removeSavedConnection(conn.id);
                              }}
                            >
                              删除
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
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
            <div className="history-toolbar">
              <input
                type="text"
                className="sidebar-filter"
                placeholder="搜索 SQL / 连接名..."
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                spellCheck={false}
              />
              <span className="history-count">
                {filteredHistory.length}
                {historyFilter && history.length !== filteredHistory.length
                  ? ` / ${history.length}`
                  : ""}
              </span>
              <button
                className="history-clear"
                onClick={async () => {
                  if (history.length === 0) return;
                  const ok = await confirm({
                    title: "清空历史",
                    description: `清空全部 ${history.length} 条历史记录?`,
                    confirmLabel: "清空",
                    variant: "danger",
                  });
                  if (ok) onClearHistory();
                }}
                disabled={history.length === 0}
              >
                清空
              </button>
            </div>
            {filteredHistory.length === 0 ? (
              <div className="sidebar-placeholder">
                {historyFilter ? "没有匹配的记录" : "查询历史将在运行查询后显示"}
              </div>
            ) : (
              filteredHistory.map((entry) => (
                <HistoryItem
                  key={entry.id}
                  entry={entry}
                  onClick={() => onHistorySelect(entry.sql)}
                  onRemove={async () => {
                    const ok = await confirm({
                      title: "删除历史记录",
                      description: "删除这条历史记录?",
                      confirmLabel: "删除",
                      variant: "danger",
                    });
                    if (ok) onHistoryRemove(entry.id);
                  }}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "files" && (
          <div className="history-list">
            <div className="history-toolbar">
              <input
                type="text"
                className="sidebar-filter"
                placeholder="搜索文件名..."
                value={filesFilter}
                onChange={(e) => setFilesFilter(e.target.value)}
                spellCheck={false}
              />
              <span className="history-count">
                {filteredFiles.length}
                {filesFilter && savedFiles.length !== filteredFiles.length
                  ? ` / ${savedFiles.length}`
                  : ""}
              </span>
            </div>
            {currentConnectionId === null && savedFiles.length > 0 && (
              <div className="sidebar-placeholder small">
                未连接:显示的是「未指定」目录的文件
              </div>
            )}
            {filteredFiles.length === 0 ? (
              <div className="sidebar-placeholder">
                {filesFilter
                  ? "没有匹配的文件"
                  : currentConnectionId
                    ? "当前连接还没有保存的查询文件"
                    : "未连接时无法保存新查询"}
              </div>
            ) : (
              filteredFiles.map((file) => (
                <FileItem
                  key={file.filename}
                  file={file}
                  isActive={file.filename === activeFilename}
                  onClick={() => onFileOpen(file.filename)}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: "删除文件",
                      description: `删除文件「${file.filename}」?`,
                      confirmLabel: "删除",
                      variant: "danger",
                    });
                    if (ok) onFileDelete(file.filename);
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>
      {confirmDialog}
    </aside>
  );
});

function HistoryItem({
  entry,
  onClick,
  onRemove,
}: {
  readonly entry: QueryHistoryEntry;
  readonly onClick: () => void;
  readonly onRemove: () => void;
}) {
  const preview = entry.sql.replace(/\s+/g, " ").slice(0, 80);
  const rel = formatRelative(entry.executedAt);
  const errorShort = entry.error
    ? entry.error.replace(/\s+/g, " ").slice(0, 40)
    : null;

  return (
    <div className="history-item">
      <Tooltip content={entry.sql}>
        <button className="history-item-main" onClick={onClick}>
        <div className="history-item-line1">
          <span className="history-item-time">{rel}</span>
          {entry.connectionName && (
            <span className="history-item-conn">{entry.connectionName}</span>
          )}
        </div>
        <div className="history-item-preview">{preview}</div>
        <div className="history-item-meta">
          {errorShort ? (
            <span className="history-status error" title={entry.error ?? ""}>
              ✕ {errorShort}
            </span>
          ) : entry.rowCount !== null ? (
            <span className="history-status ok">{entry.rowCount} 行</span>
          ) : (
            <span className="history-status muted">已执行</span>
          )}
        </div>
      </button>
      </Tooltip>
      <Tooltip content="删除这条历史">
        <button
          className="history-item-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="删除"
        >
          ×
        </button>
      </Tooltip>
    </div>
  );
}

function FileItem({
  file,
  isActive,
  onClick,
  onDelete,
}: {
  readonly file: QueryFileInfo;
  readonly isActive: boolean;
  readonly onClick: () => void;
  readonly onDelete: () => void;
}) {
  const timeStr = formatTimeMs(file.modified);
  const displayName = file.filename.replace(/^\d{8}_\d{6}_/, "").replace(/\.sql$/, "");
  const sizeStr = file.size > 1024 ? `${(file.size / 1024).toFixed(1)}K` : `${file.size}B`;

  return (
    <div className={`history-item file-item${isActive ? " active" : ""}`}>
      <Tooltip content={file.filename}>
        <button className="history-item-main" onClick={onClick}>
        <div className="history-item-line1">
          <span className="history-item-time">{timeStr}</span>
          {isActive && <span className="history-status ok">正在编辑</span>}
        </div>
        <div className="history-item-preview">{displayName || file.filename}</div>
        <div className="history-item-meta">
          <span className="history-status muted">{sizeStr}</span>
        </div>
      </button>
      </Tooltip>
      <Tooltip content="删除文件">
        <button
          className="history-item-remove"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="删除文件"
        >
          ×
        </button>
      </Tooltip>
    </div>
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

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - t);
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const d = new Date(iso);
    const nowD = new Date();
    const sameYear = d.getFullYear() === nowD.getFullYear();
    if (sameYear) {
      return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
