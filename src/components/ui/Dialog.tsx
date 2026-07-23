import * as React from "react";
import * as RDialog from "@radix-ui/react-dialog";
import "./dialog.css";

interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Hide the built-in × close button (e.g. when you render your own). */
  readonly hideClose?: boolean;
  readonly children: React.ReactNode;
  /** Extra class for the inner panel (size / padding override). */
  readonly panelClassName?: string;
}

/**
 * Modal dialog — standardised Radix-backed primitive.
 *
 * Replaces the hand-rolled overlay/escape/focus-trap logic that
 * ConnectionDialog and UpdateConfirmDialog each maintained.
 *
 * All presentational concerns are in dialog.css; semantic class names
 * follow Radix conventions (ui-dialog-overlay, ui-dialog-content, etc.).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  hideClose,
  children,
  panelClassName,
}: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ui-dialog-overlay" />
        <RDialog.Content
          className={`ui-dialog-content${panelClassName ? " " + panelClassName : ""}`}
          onEscapeKeyDown={(e) => {
            // Escape is handled by Radix; this hook exists so callers can
            // veto default-close behaviour (e.g. confirm-before-discard).
            void e;
          }}
        >
          <RDialog.Title className="ui-dialog-title">{title}</RDialog.Title>
          {description && (
            <RDialog.Description className="ui-dialog-description">
              {description}
            </RDialog.Description>
          )}
          {!hideClose && (
            <RDialog.Close
              className="ui-dialog-close"
              aria-label="关闭"
              title="关闭"
            >
              ×
            </RDialog.Close>
          )}
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* Re-export sub-components for callers that need finer control. */
export const DialogClose = RDialog.Close;
export const DialogTrigger = RDialog.Trigger;