import type { Page } from "@playwright/test";
import {
  DEMO_CONNECTION,
  DEMO_MULTI_RESULT,
  DEMO_JOIN_RESULT,
  DEMO_SCHEMA,
} from "./demo-data";

/**
 * Browser-side Tauri IPC stub.
 *
 * The app talks to Rust exclusively through `window.__TAURI_INTERNALS__.invoke`
 * (see src/lib/ipc.ts). Stubbing that one entry point lets the real React tree,
 * real CSS and real editor run in a plain browser — which is what makes both
 * the E2E specs and the README screenshots exercise production UI rather than
 * a mock-up.
 *
 * Deliberately NOT a general-purpose fake backend: unknown commands reject
 * loudly so a newly added command shows up as a failing test instead of
 * silently resolving to undefined.
 */

export interface TauriMockOptions {
  /** Pre-seed a saved connection and mark it connected. */
  readonly connected?: boolean;
  /** Pre-seed editor tab content. Defaults to the showcase join query. */
  readonly tabContent?: string;
}

const DEFAULT_TAB_CONTENT = `-- 演示查询：每个用户的订单汇总
SELECT u.id, u.email, u.country,
       COUNT(o.id) AS order_count,
       SUM(o.total_amount) AS lifetime_value
  FROM users u
  JOIN orders o ON o.user_id = u.id
 WHERE o.status = 'shipped'
 GROUP BY u.id
 ORDER BY lifetime_value DESC
 LIMIT 50;`;

/** Payload handed to the page; must be JSON-serialisable. */
interface MockPayload {
  readonly schema: unknown;
  readonly multiResult: unknown;
  readonly singleResult: unknown;
  readonly connectionName: string;
  readonly defaultTabContent: string;
}

export async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  const payload: MockPayload = {
    schema: DEMO_SCHEMA,
    multiResult: DEMO_MULTI_RESULT,
    singleResult: { results: [DEMO_JOIN_RESULT], total_duration_ms: 8 },
    connectionName: DEMO_CONNECTION.name,
    // Inlined as a string because addInitScript serialises the function and
    // re-runs it in the browser context — module-level constants from the
    // outer file are not visible there.
    defaultTabContent: options.tabContent ?? DEFAULT_TAB_CONTENT,
  };

  await page.addInitScript(
    ({ data, seed }: { data: MockPayload; seed: TauriMockOptions & { conn: unknown } }) => {
      const responses: Record<string, (args?: Record<string, unknown>) => unknown> = {
        connect: () => data.connectionName,
        disconnect: () => null,
        get_cached_schema: () => data.schema,
        refresh_schema: () => data.schema,
        diff_schema: () => ({ has_changes: false, schema: data.schema }),
        execute_query: (args) => {
          const sql = String(args?.sql ?? "");
          // Mirror the backend's multi-statement behaviour closely enough that
          // the result-tab UI is exercised, not bypassed.
          const statements = sql
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
          return statements.length > 1 ? data.multiResult : data.singleResult;
        },
        list_query_files: (args) => {
          const cid = String(args?.connectionId ?? "");
          if (!cid) return [];
          return [
            { filename: "tab_demo-1.sql", modified: 1755500000, size: 412 },
          ];
        },
        read_query_file: () => data.defaultTabContent,
        save_query_file: () => "/tmp/demo/queries/shop.db/untitled.sql",
        delete_query_file: () => null,
        scan_codebase: () => ({
          models_found: 4,
          columns_matched: 19,
          columns_unmatched: 3,
        }),
        // Column descriptions are fetched per-table on connect. The real
        // backend scans the project for matching field names; here we just
        // pretend the inference succeeded so the UI is quiet.
        // Hook expects ColumnDescription[] — returning `{}` makes
        // `for (const d of result)` throw "result is not iterable".
        get_column_descriptions: () => [],
        // ConnectionDialog's 测试连接 button — resolves OK like a healthy
        // local database would.
        test_connection_cmd: () => null,
      };

      let callbackId = 0;
      const callbacks = new Map<number, (payload: unknown) => void>();

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          const handler = responses[cmd];
          if (!handler) {
            return Promise.reject(
              new Error(`[tauri-mock] unhandled command: ${cmd} — add it to tests/fixtures/tauri-mock.ts`),
            );
          }
          return Promise.resolve(handler(args));
        },
        transformCallback: (cb: (payload: unknown) => void, once: boolean) => {
          const id = ++callbackId;
          callbacks.set(id, (p) => {
            if (once) callbacks.delete(id);
            cb(p);
          });
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        convertFileSrc: (path: string) => path,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
      };

      if (seed.connected) {
        localStorage.setItem("sql-editor-saved-connections", JSON.stringify([seed.conn]));
        // Pre-seed the tabs index so useTabStore's first effect finds files
        // to load and the editor mounts with content instead of an empty
        // textarea (which leaves the highlight overlay blank → blank shots).
        localStorage.setItem(
          "sql-editor-tabs-index",
          JSON.stringify([
            {
              id: "tab-demo-1",
              connId: seed.conn.id,
              filename: "tab_demo-1.sql",
              title: "top-customers",
              createdAt: 1755500000,
            },
          ]),
        );
      }
    },
    { data: payload, seed: { ...options, conn: DEMO_CONNECTION } },
  );
}

/** Wait until the app shell has mounted and the first editor is interactive. */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector(".app", { state: "visible" });
  await page.waitForSelector(".sql-textarea", { state: "visible" });
}

/**
 * Wait for the syntax-highlight overlay to have painted.
 *
 * The overlay is rendered from the textarea's value on a rAF after mount, so
 * an empty buffer legitimately produces an empty overlay. Only call this once
 * the editor has content — otherwise it can never become true.
 */
export async function waitForHighlight(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (document.querySelector(".sql-highlight")?.childElementCount ?? 0) > 0,
  );
}
