import { useCallback, useState } from "react";

/**
 * Unified, persisted user settings. Replaces the previous pattern where user
 * preferences (e.g. the Vim toggle) lived in ephemeral `useState` and were
 * lost on refresh. All preferences are persisted to a single localStorage
 * key and merged over sensible defaults, so new fields can be added without
 * breaking older saved state.
 *
 * This is the foundation for the customization roadmap (keymap config,
 * theme, font, AI endpoint) — extend `Settings` and consume via this hook
 * rather than scattering more ad-hoc localStorage reads.
 */

const SETTINGS_KEY = "sqleditor.settings";

export type ResultView = "table" | "json";

export interface Settings {
  /** Whether Vim mode is active in the SQL editor. */
  readonly vimEnabled: boolean;
  /** AI Panel endpoint URL. Defaults to the local NL→SQL proxy. */
  readonly aiEndpoint: string;
  /**
   * Whether the connected database's schema is attached to AI requests.
   *
   * Opt-in by design: schema is business-sensitive metadata (table and column
   * names leak your data model), and the endpoint above is user-editable, so
   * defaulting this on would mean a single settings edit silently starts
   * exfiltrating the schema. The user turns it on when they want better
   * SQL suggestions and accepts the trade-off.
   */
  readonly aiSendSchema: boolean;
  /**
   * The non-loopback endpoint the user has explicitly approved for outbound
   * requests. Cleared whenever `aiEndpoint` changes, so switching to a new
   * remote host re-prompts instead of inheriting the old approval.
   */
  readonly aiApprovedEndpoint: string | null;
  /** Active result renderer. "table" shows the virtualised grid; "json"
   *  shows a syntax-highlighted JSON view (useful for non-tabular output
   *  or quick inspection). */
  readonly resultView: ResultView;
}

const DEFAULT_SETTINGS: Settings = {
  vimEnabled: true,
  aiEndpoint: "http://localhost:8000/v1/chat/completions",
  aiSendSchema: false,
  aiApprovedEndpoint: null,
  resultView: "table",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // Merge over defaults so missing keys (e.g. after an upgrade) fall back
    // gracefully instead of becoming undefined.
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  /** Update a single setting field and persist the new state. */
  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const patched: Settings = { ...prev, [key]: value };
      // Changing the endpoint invalidates any prior outbound-data approval:
      // consent was given for a specific host, not for "whatever is
      // configured next".
      const next: Settings =
        key === "aiEndpoint" && value !== prev.aiEndpoint
          ? { ...patched, aiApprovedEndpoint: null }
          : patched;
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Quota exceeded or privacy mode — keep the in-memory value.
      }
      return next;
    });
  }, []);

  return { settings, update };
}
