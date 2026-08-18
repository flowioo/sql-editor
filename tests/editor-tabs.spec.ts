import { test, expect } from "@playwright/test";
import { installTauriMock, waitForAppReady } from "./fixtures/tauri-mock";

/**
 * Editor tab behaviour.
 *
 * Regression origin: adding a tab used to crash the React tree, leaving a tab
 * button with no mounted editor. The assertions below therefore check both
 * halves — the tab strip AND that the editor is present, sized and typable.
 */

test.beforeEach(async ({ page }) => {
  await installTauriMock(page, { connected: true });
  page.on("pageerror", (err) => {
    throw new Error(`Unexpected JS error: ${err.message}`);
  });
});

test("new query tab is created and stays editable", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // Only the active tab's editor is mounted, so the textarea count tracks
  // "visible editors", not "open tabs".
  const tabs = page.locator(".editor-tab");
  const editor = page.locator(".sql-textarea");
  const initialTabs = await tabs.count();
  await expect(editor).toHaveCount(1);

  await page.locator("button.tab-add").click();
  await expect(tabs).toHaveCount(initialTabs + 1);
  await expect(editor).toHaveCount(1);

  // The new editor must be laid out, not collapsed to zero height.
  const box = await editor.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(10);

  // Vim mode is on by default: normal mode swallows plain typing, so enter
  // insert mode first. This also asserts the Vim engine is actually wired.
  await editor.click();
  await expect(page.locator(".vim-mode")).toContainText(/normal/i);
  await page.keyboard.press("i");
  await expect(page.locator(".vim-mode")).toContainText(/insert/i);

  await page.keyboard.insertText("SELECT 1");
  await expect(editor).toHaveValue(/SELECT 1/);
});

test("switching tabs preserves each tab's content", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  const editor = page.locator(".sql-textarea");
  const tabs = page.locator(".editor-tab");

  await editor.click();
  await page.keyboard.press("i");
  // Wait for the mode flip before typing: chars sent while still in normal
  // mode are interpreted as motions and swallowed (flaky "SEE" artifacts).
  await expect(page.locator(".vim-mode")).toContainText(/insert/i);
  await page.keyboard.insertText("SELECT 'first tab';");

  await page.locator("button.tab-add").click();
  await editor.click();
  await page.keyboard.press("i");
  await expect(page.locator(".vim-mode")).toContainText(/insert/i);
  await page.keyboard.insertText("SELECT 'second tab';");
  await expect(editor).toHaveValue(/second tab/);

  // Back to the first tab — its buffer must survive the round trip.
  await tabs.first().click();
  await expect(editor).toHaveValue(/first tab/);
  await expect(editor).not.toHaveValue(/second tab/);
});
