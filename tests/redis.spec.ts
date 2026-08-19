import { test, expect } from "@playwright/test";
import { installTauriMock, waitForAppReady, connectToDemo } from "./fixtures/tauri-mock";
import { DEMO_REDIS_CONNECTION } from "./fixtures/demo-data";

/**
 * Redis dialect regressions.
 *
 * The Redis path shares the editor / autocomplete / highlight machinery
 * with SQL but switches the dialect so keyword + completion sources change.
 * If the dialect ever stops flowing from the connection → SQLEditor, these
 * tests catch it: they'd either fall through to the SQL keyword set or the
 * autocomplete popup would never surface Redis commands.
 *
 * Strategy: seed a Redis-type saved connection so dialectOfConnection()
 * resolves to "redis", then assert the dialect-specific behaviours. No
 * real Redis is contacted — the mock IPC returns a minimal single-result
 * payload so the result grid still has something to render.
 */

test.beforeEach(async ({ page }) => {
  // Disable vim so typed text lands in the textarea verbatim — vim's
  // normal-mode keymap otherwise consumes letters as commands (`:GE` opens
  // the cmd-line, `i` enters insert, etc.) and the editor never receives
  // the Redis tokens we're trying to type.
  await page.addInitScript(() => {
    localStorage.setItem("sqleditor.settings", JSON.stringify({ vimEnabled: false }));
  });
  await installTauriMock(page, {
    connected: true,
    connection: DEMO_REDIS_CONNECTION,
  });
});

/** Helper — clear the textarea and type a fresh buffer so highlight /
 *  autocomplete start from a known state. The pre-seeded SQL tab content
 *  makes "GET user:42" append to "SELECT ... LIMIT 50;GET user:42", which
 *  is awkward to assert against; clearing first gives us clean tokens.
 *
 * Uses `evaluate` to clear the DOM value + fire `input` directly so
 * SQLEditor's `onInput` handler sees a single coherent buffer change —
 * Ctrl+A → Delete through Playwright races against the textarea's
 * selection model in headless Chromium and ends up leaving stale text
 * appended at the end. */
async function replaceEditor(page: import("@playwright/test").Page, text: string): Promise<void> {
  await page.evaluate((next) => {
    const ta = document.querySelector(".sql-textarea") as HTMLTextAreaElement | null;
    if (!ta) throw new Error("textarea not mounted");
    ta.value = next;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

test("Redis commands are highlighted as keywords under the redis dialect", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  // Diagnostic: confirm the seeded connection is redis-flavoured. Without
  // this, a passing test would silently mask a wiring break (e.g. mock
  // ignoring the `connection` override and falling back to DEMO_CONNECTION).
  const stored = await page.evaluate(() => localStorage.getItem("sql-editor-saved-connections"));
  expect(stored ?? "").toContain("redis");

  await replaceEditor(page, "GET user:42");

  // The overlay mirrors the textarea token-by-token; the first word should
  // land in a sql-keyword span when the redis dialect is active.
  await expect(page.locator(".sql-highlight .sql-keyword", { hasText: "GET" })).toBeVisible();
});

test("typing 'GE' surfaces Redis-specific completions (GET / GETRANGE / GETSET)", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  await replaceEditor(page, "GE");

  const popup = page.locator(".sql-autocomplete");
  await expect(popup).toBeVisible();
  // Three GET-family commands are in the redis keyword set — if only SQL
  // keywords showed up, GETRANGE / GETSET would be missing.
  // hasText="GET" matches GET / GETRANGE / GETSET (substring), so anchor
  // to the exact label to keep it strict.
  await expect(page.locator(".sql-autocomplete-item").getByText("GET", { exact: true })).toBeVisible();
  await expect(page.locator(".sql-autocomplete-item").getByText("GETRANGE", { exact: true })).toBeVisible();
  await expect(page.locator(".sql-autocomplete-item").getByText("GETSET", { exact: true })).toBeVisible();
});

test("Redis line comments starting with # render as a comment token", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  // The tokenizer in src/editor/highlight.ts requires the commentStart
  // char twice (SQL is `--`, Redis is `##`) before opening a comment
  // span. Single `#` is treated as an identifier boundary — there's no
  // single-line `#` comment mode because Redis itself has no real
  // comments and the tokenizer stays consistent across dialects.
  await replaceEditor(page, "## 取用户资料");

  await page.waitForFunction(
    () => (document.querySelector(".sql-highlight")?.innerHTML ?? "").includes("##"),
    undefined,
    { timeout: 5000 },
  );

  const html = await page.locator(".sql-highlight").innerHTML();
  expect(html).toContain('class="sql-comment"');
});

test("running a Redis command renders the result grid", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  await replaceEditor(page, "GET user:42");

  await page.locator(".btn-run").first().click();
  // Even against a SQLite-shaped mock payload, the grid mounts because
  // Redis commands flow through the same execute_query → result-grid path.
  await expect(page.locator(".result-grid")).toBeVisible();
});