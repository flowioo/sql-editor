import { useEffect } from "react";
import "../styles/update-confirm-dialog.css";

interface UpdateConfirmDialogProps {
  /** Statements to display and (on confirm) execute as a single batch. */
  readonly sqls: readonly string[];
  /** Total number of cell changes reflected in the batch. */
  readonly changeCount: number;
  /** Run all statements via the existing executeQuery path. */
  readonly onConfirm: () => void;
  /** Discard the batch — staged edits remain on the grid for review. */
  readonly onCancel: () => void;
}

export function UpdateConfirmDialog({
  sqls,
  changeCount,
  onConfirm,
  onCancel,
}: UpdateConfirmDialogProps) {
  // Esc cancels, Enter confirms.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  const isMulti = sqls.length > 1;

  return (
    <div className="update-overlay" onClick={onCancel}>
      <div
        className="update-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <div className="update-dialog-header">
          <h2 id="update-dialog-title">确认更新</h2>
          <button
            className="update-close"
            onClick={onCancel}
            title="取消 (Esc)"
            aria-label="取消"
          >
            ×
          </button>
        </div>

        <div className="update-dialog-body">
          <div className="update-summary">
            将执行{" "}
            <strong>
              {sqls.length} 条 {isMulti ? "UPDATE" : "语句"}
            </strong>
            ,共修改 <strong>{changeCount}</strong> 个单元格。
          </div>

          <div className="update-sqls">
            {sqls.map((sql, i) => (
              <pre key={i} className="update-sql">
                <span className="update-sql-num">{i + 1}.</span>
                {sql}
              </pre>
            ))}
          </div>

          <div className="update-warning">
            ⚠ 此操作将直接写入数据库,不可撤销。建议先在事务或备份下运行。
          </div>
        </div>

        <div className="update-dialog-actions">
          <button className="btn-update-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="btn-update-confirm"
            onClick={onConfirm}
            title="Ctrl/Cmd + Enter"
          >
            执行
          </button>
        </div>
      </div>
    </div>
  );
}