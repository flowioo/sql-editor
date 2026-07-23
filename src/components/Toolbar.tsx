import type { ConnectionStatus } from "../hooks/useConnection";
import type { ScanResult } from "../hooks/useCodebaseScan";
import { Tooltip } from "./ui";
import "../styles/toolbar.css";

interface ToolbarProps {
  readonly connectionStatus: ConnectionStatus;
  readonly connectionName: string | null;
  readonly queryLoading: boolean;
  readonly schemaLoading: boolean;
  readonly scanning: boolean;
  readonly scanResult: ScanResult | null;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onRun: () => void;
  readonly onRefreshSchema: () => void;
  readonly onScanCodebase: () => void;
  readonly onToggleAI: () => void;
  readonly onToggleVim: () => void;
  readonly showAI: boolean;
  readonly vimEnabled: boolean;
  readonly vimMode?: string;
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
  scanning,
  scanResult,
  onConnect,
  onDisconnect,
  onRun,
  onRefreshSchema,
  onScanCodebase,
  onToggleAI,
  onToggleVim,
  showAI,
  vimEnabled,
  vimMode,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <Tooltip content={connectionStatus === "connected" ? "断开连接" : "连接数据库"}>
        <button
          className={`btn btn-connect ${connectionStatus}`}
          onClick={connectionStatus === "connected" ? onDisconnect : onConnect}
        >
          <span className={`status-dot ${connectionStatus}`} />
          <span>
            {connectionStatus === "connected"
              ? (connectionName ?? "已连接")
              : "连接"}
          </span>
        </button>
      </Tooltip>

      {connectionStatus === "connected" && (
        <>
          <button
            className="btn btn-run"
            onClick={onRun}
            disabled={queryLoading}
          >
            <span>{queryLoading ? "..." : ">"}</span>
            <span>{queryLoading ? "执行中..." : "运行"}</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={onRefreshSchema}
            disabled={schemaLoading}
          >
            <span>{schemaLoading ? "..." : "@"}</span>
            <span>{schemaLoading ? "刷新中..." : "刷新结构"}</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={onScanCodebase}
            disabled={scanning}
          >
            <span>{scanning ? "..." : "#"}</span>
            <span>{scanning ? "扫描中..." : "扫描代码"}</span>
          </button>

          {scanResult && (
            <span className="toolbar-scan-result">
              {scanResult.models_found} 模型, {scanResult.columns_matched} 列匹配
            </span>
          )}
        </>
      )}

      <div className="spacer" />

      <Tooltip content={vimEnabled ? "关闭 Vim 模式" : "开启 Vim 模式"}>
        <button
          className={`btn btn-secondary ${vimEnabled ? "active" : ""}`}
          onClick={onToggleVim}
        >
          <span>{vimEnabled ? (vimMode || "VIM") : "vim"}</span>
        </button>
      </Tooltip>

      <Tooltip content="AI 助手">
        <button
          className={`btn btn-secondary ${showAI ? "active" : ""}`}
          onClick={onToggleAI}
        >
          <span>AI</span>
        </button>
      </Tooltip>

      {connectionStatus === "connected" && (
        <span className="toolbar-status">{STATUS_LABELS[connectionStatus]}</span>
      )}
    </div>
  );
}
