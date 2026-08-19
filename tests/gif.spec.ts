import { test, type Page } from "@playwright/test";
import {
  installTauriMock,
  waitForAppReady,
  waitForHighlight,
} from "./fixtures/tauri-mock";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as path from "node:path";

/**
 * Syntax-highlight GIF generator.
 *
 * Not part of the normal suite — gated by `GIF=1` so it never runs in CI as a
 * pass/fail check. Captures the editor as a query is typed, showing the
 * textarea + highlight overlay updating token-by-token (keyword / string /
 * number / identifier coloring).
 *
 * Pipeline:
 *   1. type each character with a delay, snapshot after each one
 *   2. ffmpeg palettegen + paletteuse → docs/images/highlight.gif
 *
 * The mock IPC pipeline is the same as `screenshots.spec.ts` so the GIF
 * actually exercises the real editor + highlight layer.
 */

const FRAME_DIR = "tests/gif-frames";
const OUT_FILE = "docs/images/highlight.gif";

const QUERY = `SELECT id, name, email FROM users WHERE age >= 18 AND country = 'CN';`;

async function snapshotFrame(page: Page, idx: number): Promise<void> {
  // Force a paint cycle so the highlight overlay reflects the latest keystroke.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => r(null))),
  );
  await page.screenshot({
    path: path.join(FRAME_DIR, `frame_${String(idx).padStart(3, "0")}.png`),
    clip: { x: 0, y: 0, width: 1440, height: 320 },
  });
}

async function runFfmpeg(): Promise<void> {
  const paletteFile = path.join(FRAME_DIR, "palette.png");
  const args1 = [
    "-framerate",
    "12",
    "-i",
    path.join(FRAME_DIR, "frame_%03d.png"),
    "-vf",
    "palettegen=stats_mode=diff",
    "-y",
    paletteFile,
  ];
  const args2 = [
    "-framerate",
    "12",
    "-i",
    path.join(FRAME_DIR, "frame_%03d.png"),
    "-i",
    paletteFile,
    "-lavfi",
    "paletteuse=dither=bayer:bayer_scale=5",
    "-loop",
    "0",
    "-y",
    OUT_FILE,
  ];
  const run = (a: string[]): Promise<number> =>
    new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", a, { stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve(code) : reject(new Error(`ffmpeg exit ${code}`))));
      child.on("error", reject);
    });
  await run(args1);
  await run(args2);
}

test("syntax-highlight GIF", async ({ page }) => {
  test.skip(!process.env.GIF, "set GIF=1 to generate");
  await mkdir(FRAME_DIR, { recursive: true });

  await installTauriMock(page, { connected: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForAppReady(page);

  // Connect to the demo connection via the new kebab menu so useTabStore
  // loads the pre-seeded tab and the highlight overlay mounts.
  await page.locator(".sidebar-tab", { hasText: "连接" }).first().click();
  await page.waitForSelector(".conn-item", { state: "visible" });
  await page.locator(".conn-action-menu").first().click({ force: true });
  await page.locator(".ui-dropdown-item", { hasText: "连接" }).first().click();
  await waitForHighlight(page);

  // Clear the editor so typing starts from a known blank state.
  const editor = page.locator(".sql-textarea").first();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await editor.press("Backspace");
  await page.waitForTimeout(200);

  await snapshotFrame(page, 0);

  for (let i = 0; i < QUERY.length; i++) {
    await editor.pressSequentially(QUERY[i], { delay: 30 });
    // give the highlight overlay a frame to repaint
    await page.waitForTimeout(80);
    await snapshotFrame(page, i + 1);
  }

  // Hold the final state for ~1.5s before the loop so viewers can read it.
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(80);
    await snapshotFrame(page, QUERY.length + 1 + i);
  }

  await runFfmpeg();
  await rm(FRAME_DIR, { recursive: true, force: true });
});
