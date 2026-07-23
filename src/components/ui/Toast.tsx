import * as React from "react";
import * as RToast from "@radix-ui/react-toast";
import "./toast.css";

type ToastVariant = "info" | "success" | "error" | "warning";

interface ToastMessage {
  readonly id: number;
  readonly variant: ToastVariant;
  readonly title: string;
  readonly description?: string;
  readonly durationMs?: number;
}

interface ToastContextValue {
  readonly show: (
    msg: Omit<ToastMessage, "id"> & { id?: number },
  ) => number;
  readonly success: (title: string, description?: string) => number;
  readonly error: (title: string, description?: string) => number;
  readonly warning: (title: string, description?: string) => number;
  readonly info: (title: string, description?: string) => number;
  readonly dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/**
 * Provider — mount once at the top of the tree (App.tsx).
 * Holds an in-memory queue of toasts and renders Radix's <Toast.Viewport>
 * for slide-in animations.
 */
export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<readonly ToastMessage[]>([]);
  const nextIdRef = React.useRef(1);

  const dismiss = React.useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const show = React.useCallback<ToastContextValue["show"]>((msg) => {
    const id = msg.id ?? nextIdRef.current++;
    setMessages((prev) => {
      // Replace if id exists, otherwise append
      const without = prev.filter((m) => m.id !== id);
      return [...without, { ...msg, id }];
    });
    return id;
  }, []);

  const api = React.useMemo<ToastContextValue>(
    () => ({
      show,
      success: (title, description) =>
        show({ variant: "success", title, description }),
      error: (title, description) =>
        show({ variant: "error", title, description, durationMs: 6000 }),
      warning: (title, description) =>
        show({ variant: "warning", title, description, durationMs: 5000 }),
      info: (title, description) =>
        show({ variant: "info", title, description }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      <RToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {messages.map((m) => (
          <RToast.Root
            key={m.id}
            className={`ui-toast ui-toast--${m.variant}`}
            duration={m.durationMs}
            onOpenChange={(open) => {
              if (!open) dismiss(m.id);
            }}
          >
            <RToast.Title className="ui-toast-title">{m.title}</RToast.Title>
            {m.description && (
              <RToast.Description className="ui-toast-description">
                {m.description}
              </RToast.Description>
            )}
            <RToast.Close className="ui-toast-close" aria-label="关闭">
              ×
            </RToast.Close>
          </RToast.Root>
        ))}
        <RToast.Viewport className="ui-toast-viewport" />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}

/**
 * Hook — call from any component under <ToastProvider>.
 * Throws if used outside the provider (intentional — silent failure is worse).
 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}