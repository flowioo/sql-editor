import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConnectionConfig } from "../types/connection";
import { Dialog, Tooltip } from "./ui";
import "../styles/connection-dialog.css";

const STORAGE_KEY = "sql-editor-saved-connections";

export interface SavedConnection {
  readonly id: string;
  readonly name: string;
  readonly config: ConnectionConfig;
}

export function loadSavedConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeSavedConnections(list: SavedConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function saveConnection(conn: SavedConnection): void {
  const list = loadSavedConnections();
  const idx = list.findIndex((c) => c.id === conn.id);
  if (idx >= 0) {
    list[idx] = conn;
  } else {
    list.push(conn);
  }
  writeSavedConnections(list);
}

/** Update the displayed name of an existing saved connection by id. */
export function renameSavedConnection(id: string, name: string): void {
  const list = loadSavedConnections();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], name: name.trim() || list[idx].name };
  writeSavedConnections(list);
}

/** Duplicate a saved connection under a new id and append it. Returns the new entry. */
export function duplicateSavedConnection(id: string): SavedConnection | null {
  const list = loadSavedConnections();
  const src = list.find((c) => c.id === id);
  if (!src) return null;
  const newConn: SavedConnection = {
    id: `${src.id}__copy_${Date.now()}`,
    name: `${src.name} (副本)`,
    config: src.config,
  };
  list.push(newConn);
  writeSavedConnections(list);
  return newConn;
}

export function removeSavedConnection(id: string): void {
  const list = loadSavedConnections().filter((c) => c.id !== id);
  writeSavedConnections(list);
}

function parseDatabaseUrl(url: string): ConnectionConfig | null {
  try {
    const u = new URL(url);
    const type = u.protocol.replace(":", "") as "postgresql" | "mysql";
    if (type !== "postgresql" && type !== "mysql") return null;
    const password = decodeURIComponent(u.password || "");
    const database = u.pathname.replace(/^\//, "").split("?")[0];
    if (!u.hostname || !database) return null;
    return {
      type,
      host: u.hostname,
      port: u.port ? Number(u.port) : type === "postgresql" ? 5432 : 3306,
      user: decodeURIComponent(u.username || ""),
      password,
      database,
      url,
    };
  } catch {
    return null;
  }
}

function makeDefaultName(config: ConnectionConfig): string {
  switch (config.type) {
    case "sqlite":
      return config.path.split("/").pop() || config.path;
    case "postgresql":
    case "mysql":
      return `${config.database} (${config.host})`;
  }
}

interface ConnectionDialogProps {
  readonly editTarget?: SavedConnection | null;
  readonly onClose: () => void;
  readonly onConnect: (config: ConnectionConfig) => void;
}

export function ConnectionDialog({ editTarget: externalEditTarget, onClose, onConnect }: ConnectionDialogProps) {
  const [mode, setMode] = useState<"saved" | "url" | "form">("saved");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [alias, setAlias] = useState("");
  const [activeTab, setActiveTab] = useState<"sqlite" | "postgresql" | "mysql">("postgresql");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedList, setSavedList] = useState<SavedConnection[]>(loadSavedConnections);
  // Driven by App via the prop so the same dialog instance can also be opened
  // from Sidebar's "edit" button. When non-null, form is pre-filled and saving
  // preserves the original id.
  const editTarget = externalEditTarget ?? null;

  // SQLite
  const [sqlitePath, setSqlitePath] = useState("");
  // PG / MySQL
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(5432);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  // Pre-fill form whenever editTarget changes.
  useEffect(() => {
    if (!editTarget) return;
    const c = editTarget.config;
    setAlias(editTarget.name);
    setTestResult(null);
    setUrlInput("");
    setUrlError("");
    if (c.type === "sqlite") {
      setActiveTab("sqlite");
      setSqlitePath(c.path);
    } else if (c.type === "postgresql" || c.type === "mysql") {
      setActiveTab(c.type);
      setHost(c.host);
      setPort(c.port);
      setUser(c.user);
      setPassword(c.password);
      setDatabase(c.database);
    }
    setMode("form");
  }, [editTarget]);

  const DEFAULT_PORTS: Record<string, number> = { postgresql: 5432, mysql: 3306 };

  const handleTabChange = useCallback((tab: "sqlite" | "postgresql" | "mysql") => {
    setActiveTab(tab);
    setTestResult(null);
    if (tab in DEFAULT_PORTS) setPort(DEFAULT_PORTS[tab]);
  }, []);

  const buildConfig = useCallback((): ConnectionConfig | null => {
    switch (activeTab) {
      case "sqlite":
        return sqlitePath ? { type: "sqlite", path: sqlitePath } : null;
      case "postgresql":
        return host && user && database ? { type: "postgresql", host, port, user, password, database } : null;
      case "mysql":
        return host && user && database ? { type: "mysql", host, port, user, password, database } : null;
    }
  }, [activeTab, sqlitePath, host, port, user, password, database]);

  const handleTest = useCallback(async () => {
    const config = buildConfig();
    if (!config) return;
    setTesting(true);
    setTestResult(null);
    try {
      await invoke("test_connection_cmd", { config });
      setTestResult({ ok: true, msg: "连接测试成功" });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  }, [buildConfig]);

  const doConnectAndSave = useCallback((config: ConnectionConfig, name?: string, existingId?: string) => {
    const displayName = name || alias || makeDefaultName(config);
    let id: string;
    if (existingId) {
      id = existingId;
    } else if (config.type === "sqlite") {
      id = config.path;
    } else if (config.type === "postgresql") {
      id = `postgresql://${config.user}@${config.host}:${config.port}/${config.database}`;
    } else {
      id = `mysql://${config.user}@${config.host}:${config.port}/${config.database}`;
    }
    saveConnection({ id, name: displayName, config });
    setSavedList(loadSavedConnections());
    onConnect(config);
  }, [alias, onConnect]);

  const handleFormConnect = useCallback(() => {
    const config = buildConfig();
    if (!config) return;
    doConnectAndSave(config, undefined, editTarget?.id);
  }, [buildConfig, doConnectAndSave, editTarget]);

  const handleUrlConnect = useCallback(() => {
    const config = parseDatabaseUrl(urlInput.trim());
    if (!config) {
      setUrlError("无法解析连接 URL，格式: postgresql://user:***@host:port/database");
      return;
    }
    setUrlError("");
    doConnectAndSave(config, undefined, editTarget?.id);
  }, [urlInput, doConnectAndSave, editTarget]);

  const handleCancelEdit = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSavedConnect = useCallback((conn: SavedConnection) => {
    onConnect(conn.config);
  }, [onConnect]);

  const handleDeleteSaved = useCallback((id: string) => {
    removeSavedConnection(id);
    setSavedList(loadSavedConnections());
  }, []);

  const handleRenameSaved = useCallback((id: string, name: string) => {
    renameSavedConnection(id, name);
    setSavedList(loadSavedConnections());
  }, []);

  const handleDuplicateSaved = useCallback((id: string) => {
    duplicateSavedConnection(id);
    setSavedList(loadSavedConnections());
  }, []);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: "SQLite 数据库", extensions: ["db", "sqlite", "sqlite3"] }],
        multiple: false,
      });
      if (typeof selected === "string") setSqlitePath(selected);
    } catch { /* cancelled */ }
  }, []);

  const refreshSaved = useCallback(() => {
    setSavedList(loadSavedConnections());
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="连接数据库"
      panelClassName="connection-dialog-panel"
    >
      <>
        {/* Mode tabs */}
        <div className="connection-mode-tabs">
          <button className={mode === "saved" ? "active" : ""} onClick={() => { setMode("saved"); refreshSaved(); }}>
            已保存{savedList.length > 0 ? ` (${savedList.length})` : ""}
          </button>
          <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}>URL 连接</button>
          <button className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>新建连接</button>
        </div>

        {/* Saved connections */}
        {mode === "saved" && (
          <div className="connection-body">
            {savedList.length === 0 ? (
              <div className="saved-empty">暂无已保存的连接，请通过 URL 或表单新建。</div>
            ) : (
              <div className="saved-list">
                {savedList.map((conn) => (
                  <SavedItem
                    key={conn.id}
                    conn={conn}
                    onConnect={() => handleSavedConnect(conn)}
                    onDelete={() => handleDeleteSaved(conn.id)}
                    onRename={(name) => handleRenameSaved(conn.id, name)}
                    onDuplicate={() => handleDuplicateSaved(conn.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* URL mode */}
        {mode === "url" && (
          <div className="connection-body">
            <div className="form-group">
              <label>数据库连接 URL</label>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUrlError(""); }}
                placeholder="postgresql://user:password@host:5432/database?sslmode=disable"
                spellCheck={false}
              />
            </div>
            <div className="form-group">
              <label>别名（可选）</label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="例如：生产环境、测试库"
              />
            </div>
            {urlError && <div className="connection-error">{urlError}</div>}
            <div className="connection-actions">
              <button className="btn-dialog btn-connect-dialog" onClick={handleUrlConnect} disabled={!urlInput.trim()}>
                连接并保存
              </button>
            </div>
          </div>
        )}

        {/* Form mode */}
        {mode === "form" && (
          <>
            <div className="connection-tabs">
              {(["sqlite", "postgresql", "mysql"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`connection-tab${activeTab === tab ? " active" : ""}`}
                  onClick={() => handleTabChange(tab)}
                >
                  {tab === "sqlite" ? "SQLite" : tab === "postgresql" ? "PostgreSQL" : "MySQL"}
                </button>
              ))}
            </div>

            <div className="connection-body">
              <div className="form-group">
                <label>别名（可选）</label>
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="例如：生产环境、测试库"
                />
              </div>

              {activeTab === "sqlite" && (
                <div className="sqlite-file-row">
                  <div className="form-group">
                    <label>数据库文件路径</label>
                    <input type="text" value={sqlitePath} onChange={(e) => setSqlitePath(e.target.value)} placeholder="选择或输入数据库文件路径" />
                  </div>
                  <button className="btn-browse" onClick={handleBrowse}>浏览</button>
                </div>
              )}

              {(activeTab === "postgresql" || activeTab === "mysql") && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>主机</label>
                      <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
                    </div>
                    <div className="form-group">
                      <label>端口</label>
                      <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>用户名</label>
                      <input type="text" value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" />
                    </div>
                    <div className="form-group">
                      <label>密码</label>
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>数据库</label>
                    <input type="text" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="数据库名称" />
                  </div>
                </>
              )}

              {testResult && (
                <div className={testResult.ok ? "connection-success" : "connection-error"}>
                  {testResult.msg}
                </div>
              )}
            </div>

            <div className="connection-actions">
              {editTarget && (
                <button className="btn-dialog" onClick={handleCancelEdit}>取消编辑</button>
              )}
              <button className="btn-dialog btn-test" onClick={handleTest} disabled={testing}>
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button className="btn-dialog btn-connect-dialog" onClick={handleFormConnect} disabled={!buildConfig()}>
                {editTarget ? "保存并连接" : "连接并保存"}
              </button>
            </div>
          </>
        )}
      </>
    </Dialog>
  );
}

interface SavedItemProps {
  readonly conn: SavedConnection;
  readonly onConnect: () => void;
  readonly onDelete: () => void;
  readonly onRename: (name: string) => void;
  readonly onDuplicate: () => void;
}

function SavedItem({ conn, onConnect, onDelete, onRename, onDuplicate }: SavedItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conn.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (editValue.trim() && editValue.trim() !== conn.name) {
      onRename(editValue);
    }
  };

  const detail =
    conn.config.type === "sqlite"
      ? conn.config.path
      : `${conn.config.user}@${conn.config.host}:${conn.config.port}/${conn.config.database}`;

  return (
    <div
      className="saved-item"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".saved-actions")) return;
        onConnect();
      }}
    >
      <span className={`saved-type type-${conn.config.type}`}>
        {conn.config.type === "sqlite"
          ? "SQLite"
          : conn.config.type === "postgresql"
            ? "PG"
            : conn.config.type === "mysql"
              ? "MY"
              : "RD"}
      </span>
      <div className="saved-info">
        {editing ? (
          <input
            ref={inputRef}
            className="saved-rename-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); setEditing(false); setEditValue(conn.name); }
            }}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <span className="saved-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(conn.name); }}>
            {conn.name}
          </span>
        )}
        <span className="saved-detail">{detail}</span>
      </div>
      <div className="saved-actions" onClick={(e) => e.stopPropagation()}>
        <Tooltip content="连接这个数据库">
          <button className="saved-action" onClick={onConnect}>连接</button>
        </Tooltip>
        <Tooltip content="重命名这个连接">
          <button className="saved-action" onClick={() => setEditing(true)}>重命名</button>
        </Tooltip>
        <Tooltip content="复制为新连接">
          <button className="saved-action" onClick={onDuplicate}>复制</button>
        </Tooltip>
        <Tooltip content="删除这个连接">
          <button className="saved-action danger" onClick={onDelete}>删除</button>
        </Tooltip>
      </div>
    </div>
  );
}
