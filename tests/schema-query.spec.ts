import { test, expect } from "@playwright/test";
import { installTauriMock, waitForAppReady, connectToDemo } from "./fixtures/tauri-mock";

/**
 * Schema-driven query flow.
 *
 * Walks the path a real user takes when they don't already know the table
 * layout: peek the schema tree, type a SELECT with autocomplete, run it,
 * and inspect the result grid. Anything that breaks here usually means
 * schema loading, completion indexing, or the editor → backend → grid
 * round-trip is broken — all of which would be invisible to a pure
 * editor test.
 *
 * Mocks the Tauri IPC so we exercise the real React tree + completion
 * index instead of a JS-only stub. Vim is disabled so `pressSequentially`
 * lands characters in the textarea instead of being eaten by normal-mode
 * keymaps (S/i/etc.).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sqleditor.settings", JSON.stringify({ vimEnabled: false }));
  });
  await installTauriMock(page, { connected: true });
});

test("schema tree expands and lists columns for the demo database", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  // After connecting the schema tree is mounted; expand the first table
  // to make sure column rows render.
  const firstTableHeader = page.locator(".schema-table-header").first();
  await firstTableHeader.click();

  // The first demo table is `users` with an `email` column.
  await expect(page.locator(".schema-column-name", { hasText: "email" })).toBeVisible();
});

test("typing SELECT triggers autocomplete with the keyword as a candidate", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  const editor = page.locator(".sql-textarea");
  await editor.click();
  // Focus + typing produces rAF-driven highlight + autocomplete updates.
  await editor.pressSequentially("SEL", { delay: 20 });

  const popup = page.locator(".sql-autocomplete");
  await expect(popup).toBeVisible();
  // The keyword completion labels carry the bare token, no type tag — at
  // minimum `SELECT` must appear in the dropdown.
  await expect(page.locator(".sql-autocomplete-item", { hasText: "SELECT" })).toBeVisible();
});

test("dot completion surfaces columns from the matched table", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  const editor = page.locator(".sql-textarea");
  await editor.click();
  // `users.` is the canonical dot-completion trigger from the demo schema.
  await editor.pressSequentially("SELECT * FROM users.", { delay: 15 });

  const popup = page.locator(".sql-autocomplete");
  await expect(popup).toBeVisible();
  // Expect at least one column from `users` to be offered.
  await expect(page.locator(".sql-autocomplete-item", { hasText: "email" })).toBeVisible();
});

test("running the seeded query produces the result grid with demo rows", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);
  await connectToDemo(page);

  // The pre-seeded tab content is a SELECT — running it should surface the
  // join-result mock payload in the grid.
  await page.locator(".btn-run").first().click();
  await expect(page.locator(".result-grid")).toBeVisible();
  // DEMO_JOIN_RESULT columns leak through the mock; assert one column name
  // plus one row value appear. If the round-trip is broken the grid stays
  // empty (no column headers, no row data).
  await expect(page.locator(".result-grid")).toContainText("lifetime_value");
  await expect(page.locator(".result-grid")).toContainText("@example.com");
});