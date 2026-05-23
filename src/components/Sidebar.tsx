import { useState } from "react";
import "../styles/sidebar.css";

type SidebarTabKey = "connections" | "schema" | "history";

const MOCK_CONNECTIONS = [
  { id: "1", name: "生产数据库 (PostgreSQL)", detail: "pg-prod.example.com:5432 / shop_db", type: "pg" as const, online: true },
  { id: "2", name: "测试数据库 (PostgreSQL)", detail: "localhost:5432 / test_db", type: "pg" as const, online: true },
  { id: "3", name: "用户中心 (MySQL)", detail: "10.0.1.5:3306 / user_center", type: "mysql" as const, online: true },
  { id: "4", name: "本地开发 (SQLite)", detail: "~/dev/local.db", type: "sqlite" as const, online: true },
  { id: "5", name: "报表数据库", detail: "pg-report.example.com:5432 / analytics", type: "pg" as const, online: false },
];

const TAB_LABELS: Record<SidebarTabKey, string> = {
  connections: "连接",
  schema: "数据库",
  history: "历史",
};

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTabKey>("connections");
  const [selectedConn, setSelectedConn] = useState("1");

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
          <>
            <div className="conn-section-title">已保存的连接</div>
            {MOCK_CONNECTIONS.map((conn) => (
              <button
                key={conn.id}
                className={`conn-item${selectedConn === conn.id ? " active" : ""}`}
                onClick={() => setSelectedConn(conn.id)}
              >
                <div className={`conn-icon ${conn.type}`}>
                  {conn.type === "pg" ? "PG" : conn.type === "mysql" ? "MY" : "SQ"}
                </div>
                <div className="conn-info">
                  <div className="conn-name">{conn.name}</div>
                  <div className="conn-detail">{conn.detail}</div>
                </div>
                <div className={`conn-status ${conn.online ? "online" : "offline"}`} />
              </button>
            ))}
          </>
        )}

        {activeTab === "schema" && (
          <div className="sidebar-placeholder">
            数据库结构将在连接后显示
          </div>
        )}

        {activeTab === "history" && (
          <div className="sidebar-placeholder">
            查询历史将在运行查询后显示
          </div>
        )}
      </div>
    </aside>
  );
}
