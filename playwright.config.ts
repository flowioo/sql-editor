import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:1420',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
