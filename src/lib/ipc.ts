import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

/**
 * Unified invoke wrapper. Centralised here so every hook can share a single
 * error-logging policy: capture the failing command name + the underlying
 * error, then rethrow so callers can render user-facing feedback (toasts,
 * inline states, etc.).
 *
 * Why not always toast here? Toast rendering requires the ToastProvider
 * context; this module is plain TS and must not depend on React. We log
 * (so the failure is visible in devtools) and let the caller decide how
 * to surface it to the user.
 */
export async function call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.error(`[ipc] ${cmd} failed:`, e);
    throw e;
  }
}
