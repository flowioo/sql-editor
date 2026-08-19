import { test, expect, type Page } from "@playwright/test";
import {
  installTauriMock,
  waitForAppReady,
  waitForHighlight,
} from "./fixtures/tauri-mock";

/**
 * README screenshot generator.
 *
 * Not part of the normal suite — gated by `SCREENSHOTS=1` so it never runs in
 * CI as a pass/fail check. The goal is publication-quality screenshots of the
 * real UI (real components, real CSS) using the Tauri IPC mock so they can be
 * generated on any dev machine without standing up a Rust backend.
 *
 * Output: docs/images/*.png at 1440×900 viewport — matches common laptop
 * widths and keeps PNG size sensible for README rendering.
 */

const OUT_DIR = "docs/images";

/** Connect to the demo connection so schema/tabs/results are all populated. */
async function connectToDemo(page: Page): Promise<void> {
  // Sidebar opens on the schema tab; switch to connections first so the
  // "连接" buttons are in the DOM.
  await page.locator(".sidebar-tab", { hasText: "连接" }).first().click();
  await page.waitForSelector(".conn-item", { state: "visible" });
  // Open the kebab menu and pick "连接" — the old four-button layout was
  // collapsed into a single ⋯ trigger, so the dropdown item is the entry
  // point now.
  await page.locator(".conn-action-menu").first().click({ force: true });
  await page.locator(".ui-dropdown-item", { hasText: "连接" }).first().click();
  await page.waitForSelector(".schema-tree, .sql-highlight", { state: "visible" });
}

const SHOTS: ReadonlyArray<{ name: string; setup: (page: Page) => Promise<void> }> = [
  {
    name: "01-main-editor.png",
    setup: async (page) => {
      await waitForAppReady(page);
      await connectToDemo(page);
      await waitForHighlight(page);
      // Execute the buffer so the result grid renders below the editor.
      await page.locator(".btn-run").first().click();
      await page.waitForSelector(".result-grid, .result-empty", { state: "visible" });
      await page.waitForTimeout(300);
    },
  },
  {
    name: "02-schema-tree.png",
    setup: async (page) => {
      await waitForAppReady(page);
      await connectToDemo(page);
      // Switch sidebar to schema tab.
      await page.locator(".sidebar-tab", { hasText: "数据库" }).first().click();
      await page.waitForSelector(".schema-tree", { state: "visible" });
      // Expand the first two tables for a populated look.
      await page.locator(".schema-table-header").first().click();
      await page.locator(".schema-table-header").nth(1).click();
      await page.waitForTimeout(150);
    },
  },
  {
    name: "03-connection-dialog.png",
    setup: async (page) => {
      await waitForAppReady(page);
      await page.locator(".sidebar-tab", { hasText: "连接" }).first().click();
      await page.waitForSelector(".conn-new-btn", { state: "visible" });
      await page.locator(".conn-new-btn").first().click({ force: true });
      await page.waitForSelector('[role="dialog"]', { state: "visible" });
      // Switch the dialog from "连接" tab to "新建" via the bottom button.
      // force: true because a Radix Tooltip portal intercepts hover events
      // for a frame after the button becomes interactive.
      await page.waitForSelector(".btn-new-connection", { state: "visible" });
      await page.evaluate(() => {
        const btn = document.querySelector(".btn-new-connection") as HTMLButtonElement;
        btn?.click();
      });
      await page.waitForTimeout(300);
      await page.waitForTimeout(300);
    },
  },
  {
    name: "04-vim-mode.png",
    setup: async (page) => {
      await waitForAppReady(page);
      await connectToDemo(page);
      await waitForHighlight(page);
      const editor = page.locator("textarea.sql-textarea");
      await editor.click();
      // Esc to normal, then `d` to enter operator-pending — captures the
      // distinctive "d" indicator without mutating the buffer.
      await page.keyboard.press("Escape");
      await page.keyboard.press("d");
      await page.waitForTimeout(150);
    },
  },
  {
    name: "05-ai-panel.png",
    setup: async (page) => {
      // Pre-seed a remote endpoint so the privacy bar shows its warn state.
      await page.addInitScript(() => {
        localStorage.setItem(
          "sqleditor.settings",
          JSON.stringify({
            vimEnabled: true,
            aiEndpoint: "https://api.openai.example/v1/chat/completions",
            aiSendSchema: true,
            aiApprovedEndpoint: null,
            resultView: "table",
          }),
        );
      });
      await waitForAppReady(page);
      await connectToDemo(page);
      // AIPanel is hidden behind a toolbar toggle. Open it before asserting.
      await page.locator(".btn-secondary", { hasText: /AI/ }).first().click({ force: true });
      await page.waitForSelector(".ai-panel", { state: "visible", timeout: 15000 });
      // Flip the endpoint to a remote URL through the UI — clicking the
      // privacy toggle's checkbox and using a custom flow would be fragile,
      // so we use the same code path as a real user (typing into a future
      // settings dialog). For the screenshot we just rewrite localStorage
      // and reload — the privacy bar will re-render with the remote badge.
      await page.evaluate(() => {
        localStorage.setItem(
          "sqleditor.settings",
          JSON.stringify({
            vimEnabled: true,
            aiEndpoint: "https://api.openai.example/v1/chat/completions",
            aiSendSchema: true,
            aiApprovedEndpoint: null,
            resultView: "table",
          }),
        );
      });
      await page.reload();
      await waitForAppReady(page);
      // Re-open AI panel after reload (toolbar state isn't persisted).
      await page.locator(".btn-secondary", { hasText: /AI/ }).first().click({ force: true });
      await page.waitForSelector(".ai-endpoint-badge.remote", { state: "visible", timeout: 15000 });
    },
  },
];

test.describe.configure({ mode: "serial" });

for (const shot of SHOTS) {
  test(`screenshot: ${shot.name}`, async ({ page }) => {
    test.setTimeout(30000);
    await installTauriMock(page, { connected: true });
    page.on("pageerror", (err) => {
      console.warn(`[${shot.name}] pageerror:`, err.message);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await shot.setup(page);
    await page.screenshot({
      path: `${OUT_DIR}/${shot.name}`,
      fullPage: false,
      scale: "css",
    });
    expect((await page.evaluate(() => document.title)) || "").toBeTruthy();
  });
}