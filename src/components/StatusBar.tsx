import "../styles/statusbar.css";

interface StatusBarProps {
  readonly vimMode: string;
  readonly cursorLine: number;
  readonly cursorCol: number;
}

export function StatusBar({ vimMode, cursorLine, cursorCol }: StatusBarProps) {
  return (
    <div className="status-bar">
      <span className="status-item">
        {vimMode}
      </span>
      <span className="spacer" />
      <span className="status-item">
        行 {cursorLine}，列 {cursorCol}
      </span>
    </div>
  );
}
