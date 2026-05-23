import type { VimMode } from "../hooks/useVimMode";
import { useVimMode } from "../hooks/useVimMode";
import "../styles/statusbar.css";

const MODE_LABELS: Record<VimMode, string> = {
  normal: "普通",
  insert: "插入",
  visual: "可视",
};

interface StatusBarProps {
  readonly vimMode: VimMode;
  readonly cursorLine: number;
  readonly cursorCol: number;
}

export function StatusBar({ vimMode, cursorLine, cursorCol }: StatusBarProps) {
  const { getVimModeLabel } = useVimMode();
  return (
    <div className="status-bar">
      <span className="status-item">
        {getVimModeLabel(vimMode)} | {MODE_LABELS[vimMode]}模式
      </span>
      <span className="spacer" />
      <span className="status-item">
        行 {cursorLine}，列 {cursorCol}
      </span>
    </div>
  );
}
