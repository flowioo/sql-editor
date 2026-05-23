import { useState } from "react";
import type { DatabaseSchema } from "../hooks/useSchema";
import { SchemaTree } from "./SchemaTree";
import "../styles/sidebar.css";

type SidebarTabKey = "connections" | "schema" | "history";

interface SidebarProps {
  readonly schema: DatabaseSchema | null;
}

const TAB_LABELS: Record<SidebarTabKey, string> = {
  connections: "连接",
  schema: "数据库",
  history: "历史",
};

export function Sidebar({ schema }: SidebarProps) {
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
            点击工具栏「打开数据库」按钮连接 SQLite 文件
          </div>
        )}

        {activeTab === "schema" && <SchemaTree schema={schema} />}

        {activeTab === "history" && (
          <div className="sidebar-placeholder">
            查询历史将在运行查询后显示
          </div>
        )}
      </div>
    </aside>
  );
}
