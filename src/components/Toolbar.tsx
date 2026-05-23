import type { ConnectionStatus } from "../hooks/useConnection";
import "../styles/toolbar.css";

interface ToolbarProps {
  readonly connectionStatus: ConnectionStatus;
  readonly connectionName: string | null;
  readonly queryLoading: boolean;
  readonly schemaLoading: boolean;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onRun: () => void;
  readonly onRefreshSchema: () => void;
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "未连接",
  connecting: "连接中…",
  connected: "已连接",
};

export function Toolbar({
  connectionStatus,
  connectionName,
  queryLoading,
  schemaLoading,
  onConnect,
  onDisconnect,
  onRun,
  onRefreshSchema,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <button
        className={`btn btn-connect ${connectionStatus}`}
        onClick={connectionStatus === "connected" ? onDisconnect : onConnect}
        title={connectionStatus === "connected" ? "断开连接" : "打开数据库文件"}
      >
        <span className={`status-dot ${connectionStatus}`} />
        <span>
          {connectionStatus === "connected"
            ? (connectionName ?? "已连接")
            : "打开数据库"}
        </span>
      </button>

      {connectionStatus === "connected" && (
        <>
          <button
            className="btn btn-run"
            onClick={onRun}
            disabled={queryLoading}
          >
            <span>{queryLoading ? "⏳" : "▶"}</span>
            <span>{queryLoading ? "执行中…" : "运行"}</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={onRefreshSchema}
            disabled={schemaLoading}
          >
            <span>{schemaLoading ? "⏳" : "↻"}</span>
            <span>{schemaLoading ? "刷新中…" : "刷新结构"}</span>
          </button>
        </>
      )}

      <div className="spacer" />

      {connectionStatus === "connected" && (
        <span className="toolbar-status">{STATUS_LABELS[connectionStatus]}</span>
      )}
    </div>
  );
}
