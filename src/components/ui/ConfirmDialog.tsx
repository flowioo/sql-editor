import * as React from "react";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: "default" | "danger";
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Confirm/alert dialog — wraps the shared <Dialog> primitive with a
 * standardised action row. Use for destructive actions (delete, disconnect)
 * so users get a single, branded confirmation experience instead of the
 * browser's plain `window.confirm`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={title}
      description={description}
      panelClassName="ui-dialog-content--narrow"
    >
      <div className="ui-confirm-actions">
        <button
          className="btn-dialog"
          onClick={onCancel}
          autoFocus
        >
          {cancelLabel}
        </button>
        <button
          className={`btn-dialog ${variant === "danger" ? "btn-confirm-danger" : "btn-confirm-default"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
