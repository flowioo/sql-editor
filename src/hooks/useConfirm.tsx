import { useCallback, useState } from "react";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

interface ConfirmState {
  readonly open: boolean;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly variant: "default" | "danger";
  readonly resolve: (ok: boolean) => void;
}

/**
 * Promise-based confirmation dialog helper. Returns:
 *   - `confirm(opts)`: shows the dialog, resolves true on confirm / false on cancel.
 *   - `dialog`: the React element to mount in the JSX tree.
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title: "确定删除?", variant: "danger" })) { ... }
 *   return <>{dialog}</>;
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (opts: {
      title: React.ReactNode;
      description?: React.ReactNode;
      confirmLabel?: string;
      cancelLabel?: string;
      variant?: "default" | "danger";
    }): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          open: true,
          title: opts.title,
          description: opts.description,
          confirmLabel: opts.confirmLabel ?? "确认",
          cancelLabel: opts.cancelLabel ?? "取消",
          variant: opts.variant ?? "default",
          resolve,
        });
      });
    },
    [],
  );

  const close = useCallback((ok: boolean) => {
    setState((s) => {
      if (s) s.resolve(ok);
      return null;
    });
  }, []);

  const dialog = state ? (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, dialog };
}
