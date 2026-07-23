import { useEffect } from "react";
import { Dialog } from "./ui";
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
  // Cmd/Ctrl+Enter confirms. Escape is handled by the Radix Dialog itself
  // (it forwards to onOpenChange which we wire to onCancel below).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onConfirm]);

  const isMulti = sqls.length > 1;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title="确认更新"
      panelClassName="update-dialog-panel"
    >
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
    </Dialog>
  );
}