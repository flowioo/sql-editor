import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConnectionConfig, ConnectionType } from "../types/connection";
import "../styles/connection-dialog.css";

const DB_TABS: { readonly key: ConnectionType; readonly label: string }[] = [
  { key: "sqlite", label: "SQLite" },
  { key: "postgresql", label: "PostgreSQL" },
  { key: "mysql", label: "MySQL" },
];

const DEFAULT_PORTS: Record<string, number> = {
  postgresql: 5432,
  mysql: 3306,
};

interface ConnectionDialogProps {
  readonly onClose: () => void;
  readonly onConnect: (config: ConnectionConfig) => void;
}

export function ConnectionDialog({ onClose, onConnect }: ConnectionDialogProps) {
  const [activeTab, setActiveTab] = useState<ConnectionType>("sqlite");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // SQLite
  const [sqlitePath, setSqlitePath] = useState("");

  // PG / MySQL common fields
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(5432);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  const handleTabChange = useCallback((tab: ConnectionType) => {
    setActiveTab(tab);
    setTestResult(null);
    if (tab === "postgresql") setPort(DEFAULT_PORTS.postgresql);
    if (tab === "mysql") setPort(DEFAULT_PORTS.mysql);
  }, []);

  const buildConfig = useCallback((): ConnectionConfig | null => {
    switch (activeTab) {
      case "sqlite":
        if (!sqlitePath) return null;
        return { type: "sqlite", path: sqlitePath };
      case "postgresql":
        if (!host || !user || !database) return null;
        return { type: "postgresql", host, port, user, password, database };
      case "mysql":
        if (!host || !user || !database) return null;
        return { type: "mysql", host, port, user, password, database };
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
    onConnect(config);
  }, [buildConfig, onConnect]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: "SQLite 数据库", extensions: ["db", "sqlite", "sqlite3"] }],
        multiple: false,
      });
      if (typeof selected === "string") {
        setSqlitePath(selected);
      }
    } catch {
      // cancelled
    }
  }, []);

  return (
    <div className="connection-overlay" onClick={onClose}>
      <div className="connection-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="connection-header">
          <h2>连接数据库</h2>
          <button className="connection-close" onClick={onClose}>x</button>
        </div>

        <div className="connection-tabs">
          {DB_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`connection-tab${activeTab === tab.key ? " active" : ""}`}
              onClick={() => handleTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="connection-body">
          {activeTab === "sqlite" && (
            <div className="sqlite-file-row">
              <div className="form-group">
                <label>数据库文件路径</label>
                <input
                  type="text"
                  value={sqlitePath}
                  onChange={(e) => setSqlitePath(e.target.value)}
                  placeholder="选择或输入数据库文件路径"
                />
              </div>
              <button className="btn-browse" onClick={handleBrowse}>浏览</button>
            </div>
          )}

          {(activeTab === "postgresql" || activeTab === "mysql") && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>主机</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="localhost"
                  />
                </div>
                <div className="form-group">
                  <label>端口</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    placeholder={String(DEFAULT_PORTS[activeTab] ?? 5432)}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>用户名</label>
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="root"
                  />
                </div>
                <div className="form-group">
                  <label>密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="密码"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>数据库</label>
                <input
                  type="text"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="数据库名称"
                />
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
          <button
            className="btn-dialog btn-test"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? "测试中..." : "测试连接"}
          </button>
          <button
            className="btn-dialog btn-connect-dialog"
            onClick={handleConnect}
            disabled={!buildConfig()}
          >
            连接
          </button>
        </div>
      </div>
    </div>
  );
}
