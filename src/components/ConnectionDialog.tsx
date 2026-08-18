import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConnectionConfig } from "../types/connection";
import { Dialog } from "./ui";
import { loadPassword, materializeConfig } from "../lib/credentials";
import {
  loadSavedConnections,
  saveConnection,
  renameSavedConnection,
  duplicateSavedConnection,
  removeSavedConnection,
  subscribe as subscribeSavedConnections,
  type SavedConnection,
} from "../lib/savedConnections";
import { parseDatabaseUrl, makeDefaultName } from "../lib/connection-url";
import { useConfirm } from "../hooks/useConfirm";
import { SavedItem } from "./SavedItem";
import "../styles/connection-dialog.css";

export type { SavedConnection } from "../lib/savedConnections";

interface ConnectionDialogProps {
  readonly editTarget?: SavedConnection | null;
  readonly onClose: () => void;
  readonly onConnect: (config: ConnectionConfig) => void;
}

export function ConnectionDialog({ editTarget: externalEditTarget, onClose, onConnect }: ConnectionDialogProps) {
  // Top-level tabs: saved-connection list vs. the "create new" pane. The URL
  // input lives inside the "new" pane as a secondary input mode.
  const [mode, setMode] = useState<"saved" | "new">("saved");
  const [inputMode, setInputMode] = useState<"form" | "url">("form");
  const [search, setSearch] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [alias, setAlias] = useState("");
  const [activeTab, setActiveTab] = useState<"sqlite" | "postgresql" | "mysql" | "redis">("postgresql");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedList, setSavedList] = useState<SavedConnection[]>(loadSavedConnections);
  const { confirm, dialog: confirmDialog } = useConfirm();
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

  // Re-read the saved list when the underlying store changes (rename /
  // duplicate / remove from Sidebar or another dialog instance). This
  // replaces the previous App-level version counter.
  useEffect(() => subscribeSavedConnections(() => setSavedList(loadSavedConnections())), []);

  // Pre-fill form whenever editTarget changes. The password is loaded
  // asynchronously from the OS keychain (it is not stored in localStorage).
  useEffect(() => {
    if (!editTarget) return;
    const c = editTarget.config;
    setAlias(editTarget.name);
    setTestResult(null);
    setUrlInput("");
    setUrlError("");
    let cancelled = false;
    if (c.type === "sqlite") {
      setActiveTab("sqlite");
      setSqlitePath(c.path);
    } else if (c.type === "redis") {
      setActiveTab("redis");
      setHost(c.host);
      setPort(c.port);
      // `database` state is a string (shared with PG/MySQL db names); the Redis
      // db index round-trips through String/Number.
      setDatabase(String(c.database));
      setPassword("");
      loadPassword(editTarget.id)
        .then((pwd) => { if (!cancelled) setPassword(pwd ?? ""); })
        .catch(() => { /* keychain unavailable — leave blank */ });
    } else {
      setActiveTab(c.type);
      setHost(c.host);
      setPort(c.port);
      setUser(c.user);
      setDatabase(c.database);
      setPassword("");
      loadPassword(editTarget.id)
        .then((pwd) => { if (!cancelled) setPassword(pwd ?? ""); })
        .catch(() => { /* keychain unavailable — leave blank */ });
    }
    setInputMode("form");
    setMode("new");
    return () => { cancelled = true; };
  }, [editTarget]);

  const DEFAULT_PORTS: Record<string, number> = { postgresql: 5432, mysql: 3306, redis: 6379 };

  const handleTabChange = useCallback((tab: "sqlite" | "postgresql" | "mysql" | "redis") => {
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
      case "redis":
        return host ? { type: "redis", host, port, password, database: Number(database) || 0 } : null;
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

  const doConnectAndSave = useCallback(async (config: ConnectionConfig, name?: string, existingId?: string) => {
    const displayName = name || alias || makeDefaultName(config);
    // New connections get a random id so saving two configs for the same
    // database (e.g. different credentials / aliases) no longer collide.
    // Editing an existing connection preserves its id.
    const id = existingId ?? crypto.randomUUID();
    // saveConnection stores the real password in the OS keychain and a
    // passwordless copy in localStorage.
    try {
      await saveConnection({ id, name: displayName, config });
    } catch (e) {
      setTestResult({ ok: false, msg: `保存连接失败（密码无法写入系统密钥链）: ${String(e)}` });
      return;
    }
    setSavedList(loadSavedConnections());
    onConnect(config);
  }, [alias, onConnect]);

  const handleFormConnect = useCallback(() => {
    const config = buildConfig();
    if (!config) return;
    void doConnectAndSave(config, undefined, editTarget?.id);
  }, [buildConfig, doConnectAndSave, editTarget]);

  const handleUrlConnect = useCallback(() => {
    const config = parseDatabaseUrl(urlInput.trim());
    if (!config) {
      setUrlError("无法解析连接 URL，格式: postgresql://user:***@host:port/database");
      return;
    }
    setUrlError("");
    void doConnectAndSave(config, undefined, editTarget?.id);
  }, [urlInput, doConnectAndSave, editTarget]);

  const handleCancelEdit = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSavedConnect = useCallback(async (conn: SavedConnection) => {
    const config = await materializeConfig(conn);
    onConnect(config);
  }, [onConnect]);

  const handleDeleteSaved = useCallback(async (id: string, name: string) => {
    const ok = await confirm({
      title: "删除连接",
      description: `确定要删除连接「${name}」?此操作无法撤销。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!ok) return;
    await removeSavedConnection(id);
    setSavedList(loadSavedConnections());
  }, [confirm]);

  const handleRenameSaved = useCallback((id: string, name: string) => {
    renameSavedConnection(id, name);
    setSavedList(loadSavedConnections());
  }, []);

  const handleDuplicateSaved = useCallback(async (id: string) => {
    await duplicateSavedConnection(id);
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

  /** Switch to the 新建 pane — from the tab itself or the "+ 新建连接"
   *  button at the bottom of the saved list. Clears stale test feedback. */
  const handleSwitchToNew = useCallback(() => {
    setMode("new");
    setTestResult(null);
    refreshSaved();
  }, [refreshSaved]);

  const filteredSaved = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return savedList;
    return savedList.filter((conn) => {
      const detail = conn.config.type === "sqlite"
        ? conn.config.path
        : conn.config.type === "redis"
          ? `${conn.config.host}:${conn.config.port}/db${conn.config.database}`
          : `${conn.config.user}@${conn.config.host}:${conn.config.port}/${conn.config.database}`;
      return conn.name.toLowerCase().includes(q) || detail.toLowerCase().includes(q);
    });
  }, [savedList, search]);

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
        {/* Top-level mode tabs: 连接 / 新建 */}
        <div className="connection-mode-tabs">
          <button className={mode === "saved" ? "active" : ""} onClick={() => { setMode("saved"); refreshSaved(); }}>
            连接{savedList.length > 0 ? ` (${savedList.length})` : ""}
          </button>
          <button className={mode === "new" ? "active" : ""} onClick={handleSwitchToNew}>新建</button>
        </div>

        {/* Saved connections */}
        {mode === "saved" && (
          <div className="connection-body">
            {savedList.length > 0 && (
              <div className="form-group">
                <input
                  className="saved-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索连接..."
                  spellCheck={false}
                />
              </div>
            )}
            {savedList.length === 0 ? (
              <div className="saved-empty">暂无已保存的连接，点击下方按钮新建。</div>
            ) : filteredSaved.length === 0 ? (
              <div className="saved-empty">没有匹配「{search.trim()}」的连接。</div>
            ) : (
              <div className="saved-list">
                {filteredSaved.map((conn) => (
                  <SavedItem
                    key={conn.id}
                    conn={conn}
                    onConnect={() => handleSavedConnect(conn)}
                    onDelete={() => handleDeleteSaved(conn.id, conn.name)}
                    onRename={(name) => handleRenameSaved(conn.id, name)}
                    onDuplicate={() => handleDuplicateSaved(conn.id)}
                  />
                ))}
              </div>
            )}
            <button className="btn-new-connection" onClick={handleSwitchToNew}>+ 新建连接</button>
          </div>
        )}

        {/* New-connection pane: URL input or typed form */}
        {mode === "new" && (
          <>
            <div className="new-mode-switch">
              <button className={inputMode === "form" ? "active" : ""} onClick={() => setInputMode("form")}>表单</button>
              <button className={inputMode === "url" ? "active" : ""} onClick={() => setInputMode("url")}>URL</button>
            </div>

            {inputMode === "url" && (
              <div className="connection-body">
                <div className="form-group">
                  <label>数据库连接 URL</label>
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value); setUrlError(""); }}
                    placeholder="postgresql://user:password@host:5432/database 或 redis://:password@host:6379/0"
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

            {inputMode === "form" && (
              <>
            <div className="connection-tabs">
              {(["sqlite", "postgresql", "mysql", "redis"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`connection-tab${activeTab === tab ? " active" : ""}`}
                  onClick={() => handleTabChange(tab)}
                >
                  {tab === "sqlite" ? "SQLite" : tab === "postgresql" ? "PostgreSQL" : tab === "mysql" ? "MySQL" : "Redis"}
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

              {activeTab === "redis" && (
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
                      <label>密码（可选）</label>
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
                    </div>
                    <div className="form-group">
                      <label>库编号</label>
                      <input type="number" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="0" />
                    </div>
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
        )}
      </>
      {confirmDialog}
    </Dialog>
  );
}
