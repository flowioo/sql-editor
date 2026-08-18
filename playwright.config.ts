import { defineConfig } from '@playwright/test';

const PORT = 1420;

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  // Screenshot generation is opt-in: it writes into docs/images/ and is not a
  // pass/fail check, so it must not run as part of the normal suite or CI.
  testIgnore: process.env.SCREENSHOTS ? [] : ['**/screenshots.spec.ts'],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Own the dev server so `pnpm test` works from a clean checkout instead of
  // silently failing when nothing is listening on 1420.
  webServer: {
    command: 'pnpm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
