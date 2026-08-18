import { test, expect } from "@playwright/test";
import { installTauriMock, waitForAppReady } from "./fixtures/tauri-mock";

/**
 * ConnectionDialog flows.
 *
 * Regression origin (severe): loadSavedConnections() cloned every entry
 * unconditionally, so its own change-detection always fired →
 * write → notify → listener load → write … a synchronous infinite recursion
 * whose RangeErrors were swallowed by the catch block. Symptom: clicking
 * anything that called refreshSaved() (+ 新建连接 / the 新建 tab) hard-froze
 * the page with zero console output. The "new pane renders" assertions below
 * would hang forever against that bug.
 */

test.beforeEach(async ({ page }) => {
  await installTauriMock(page, { connected: true });
});

test("opening the 新建 pane does not freeze the app", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // Sidebar → connections tab → 新建 opens the dialog in saved mode.
  await page.locator(".sidebar-tab", { hasText: "连接" }).first().click();
  await page.locator(".conn-new-btn").first().click({ force: true });
  await expect(page.locator('[role="dialog"]')).toBeVisible();

  // Switch to the create-new pane via the bottom button. Against the
  // recursion bug this never resolves and the test times out.
  await page.locator(".btn-new-connection").first().click();
  await expect(page.locator(".connection-tabs")).toBeVisible();

  // The mode tab at the top must agree, and switching back to the saved
  // list must still work (the notify-listen cycle runs on every switch).
  await page.locator(".connection-mode-tabs button", { hasText: "连接" }).first().click();
  await expect(page.locator(".saved-list")).toBeVisible();
  await page.locator(".connection-mode-tabs button", { hasText: "新建" }).first().click();
  await expect(page.locator(".connection-tabs")).toBeVisible();
});

test("saving with missing required fields shows inline validation", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  await page.locator(".sidebar-tab", { hasText: "连接" }).first().click();
  await page.locator(".conn-new-btn").first().click({ force: true });
  await page.locator(".btn-new-connection").first().click();
  await expect(page.locator(".connection-tabs")).toBeVisible();

  // PostgreSQL form starts empty (host is pre-filled with "localhost", but
  // user / database are blank). Clear host to force a full-missing case.
  await page.locator('input[placeholder="localhost"]').first().fill("");

  await page.locator(".btn-connect-dialog").last().click();
  // Inline error names the missing fields instead of the button silently
  // doing nothing (the original "no reaction" complaint).
  await expect(page.locator(".connection-error")).toContainText("请填写必填项");
});
