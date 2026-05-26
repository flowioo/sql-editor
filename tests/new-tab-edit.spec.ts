import { test, expect } from '@playwright/test';

test('new query tab should be editable', async ({ page }) => {
  page.on('pageerror', err => { throw new Error(`Unexpected JS error: ${err.message}`); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Step 1: Initial state has 1 tab and 1 editor
  expect(await page.locator('.editor-tab').count()).toBe(1);
  expect(await page.locator('.cm-editor').count()).toBe(1);

  // Step 2: Click + to add new tab — should not crash React
  await page.locator('button.tab-add').click();
  await page.waitForTimeout(1500);
  expect(await page.locator('.editor-tab').count()).toBe(2);
  expect(await page.locator('.cm-editor').count()).toBe(1);

  // Step 3: New editor is visible with correct content
  const editor = page.locator('.cm-editor').last();
  const box = await editor.boundingBox();
  expect(box?.height).toBeGreaterThan(10);
  const lines = await editor.locator('.cm-line').allTextContents();
  expect(lines.some(l => l.includes('新查询'))).toBeTruthy();

  // Step 4: Editor accepts input (click → enter insert mode → type)
  await editor.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('i');  // enter vim insert mode
  await page.waitForTimeout(200);
  await page.keyboard.insertText('SELECT 1');
  await page.waitForTimeout(300);
  
  const linesAfter = await editor.locator('.cm-line').allTextContents();
  expect(linesAfter.some(l => l.includes('SELECT 1'))).toBeTruthy();
});
