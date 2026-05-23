import "../styles/toolbar.css";

const CONNECTIONS = [
  "生产数据库 (PostgreSQL)",
  "测试数据库 (PostgreSQL)",
  "用户中心 (MySQL)",
  "本地开发 (SQLite)",
];

interface ToolbarProps {
  readonly onRun: () => void;
  readonly onSave: () => void;
}

export function Toolbar({ onRun, onSave }: ToolbarProps) {
  return (
    <div className="toolbar">
      <select className="conn-select" defaultValue={CONNECTIONS[0]}>
        {CONNECTIONS.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>

      <button className="btn btn-run" onClick={onRun}>
        <span>▶</span>
        <span>运行</span>
      </button>

      <button className="btn btn-secondary" onClick={onSave}>
        <span>💾</span>
        <span>保存</span>
      </button>

      <div className="spacer" />
    </div>
  );
}
