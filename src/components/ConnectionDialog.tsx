import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConnectionConfig } from "../types/connection";
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

export function saveConnection(conn: SavedConnection): void {
  const list = loadSavedConnections();
  const idx = list.findIndex((c) => c.id === conn.id);
  if (idx >= 0) {
    list[idx] = conn;
  } else {
    list.push(conn);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function removeSavedConnection(id: string): void {
  const list = loadSavedConnections().filter((c) => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function parseDatabaseUrl(url: string): ConnectionConfig | null {
  // postgresql://user:pass@host:port/db?sslmode=disable
  // mysql://user:pass@host:port/db
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
    };
  } catch {
    return null;
  }
}

interface ConnectionDialogProps {
  readonly onClose: () => void;
  readonly onConnect: (config: ConnectionConfig) => void;
}

export function ConnectionDialog({ onClose, onConnect }: ConnectionDialogProps) {
  const [mode, setMode] = useState<"form" | "url">("form");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [activeTab, setActiveTab] = useState<"sqlite" | "postgresql" | "mysql">("postgresql");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedList, setSavedList] = useState<SavedConnection[]>(loadSavedConnections());

  // SQLite
  const [sqlitePath, setSqlitePath] = useState("");
  // PG / MySQL
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(5432);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

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

  const handleConnect = useCallback(() => {
    const config = buildConfig();
    if (!config) return;
    // Auto-save connection
    const id = config.type === "sqlite" ? config.path : `${config.type}://${config.user}@${config.host}:${config.port}/${config.database}`;
    const name = config.type === "sqlite"
      ? config.path.split("/").pop() || config.path
      : `${config.database} (${config.host})`;
    saveConnection({ id, name, config });
    setSavedList(loadSavedConnections());
    onConnect(config);
  }, [buildConfig, onConnect]);

  const handleUrlConnect = useCallback(() => {
    const config = parseDatabaseUrl(urlInput.trim());
    if (!config) {
      setUrlError("无法解析连接 URL，格式: postgresql://user:pass@host:port/database");
      return;
    }
    setUrlError("");
    // Auto-save
    const id = `${config.type}://${config.user}@${config.host}:${config.port}/${config.database}`;
    const name = `${config.database} (${config.host})`;
    saveConnection({ id, name, config });
    setSavedList(loadSavedConnections());
    onConnect(config);
  }, [urlInput, onConnect]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: "SQLite 数据库", extensions: ["db", "sqlite", "sqlite3"] }],
        multiple: false,
      });
      if (typeof selected === "string") setSqlitePath(selected);
    } catch { /* cancelled */ }
  }, []);

  const handleSavedConnect = useCallback((conn: SavedConnection) => {
    onConnect(conn.config);
  }, [onConnect]);

  const handleDeleteSaved = useCallback((id: string) => {
    removeSavedConnection(id);
    setSavedList(loadSavedConnections());
  }, []);

  return (
    <div className="connection-overlay" onClick={onClose}>
      <div className="connection-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="connection-header">
          <h2>连接数据库</h2>
          <button className="connection-close" onClick={onClose}>x</button>
        </div>

        {/* Saved connections */}
        {savedList.length > 0 && (
          <div className="saved-connections">
            <div className="saved-header">已保存的连接</div>
            {savedList.map((conn) => (
              <div key={conn.id} className="saved-item">
                <span className="saved-type">{conn.config.type === "sqlite" ? "SQLite" : conn.config.type === "postgresql" ? "PG" : "MY"}</span>
                <span className="saved-name" onClick={() => handleSavedConnect(conn)}>{conn.name}</span>
                <button className="saved-delete" onClick={() => handleDeleteSaved(conn.id)}>删除</button>
              </div>
            ))}
          </div>
        )}

        {/* Mode tabs: URL / Form */}
        <div className="connection-mode-tabs">
          <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}>URL 快速连接</button>
          <button className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>表单连接</button>
        </div>

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
            {urlError && <div className="connection-error">{urlError}</div>}
            <div className="connection-actions">
              <button className="btn-dialog btn-connect-dialog" onClick={handleUrlConnect} disabled={!urlInput.trim()}>
                连接
              </button>
            </div>
          </div>
        )}

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
              <button className="btn-dialog btn-test" onClick={handleTest} disabled={testing}>
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button className="btn-dialog btn-connect-dialog" onClick={handleConnect} disabled={!buildConfig()}>
                连接
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
