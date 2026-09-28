import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/search', timeout: 120000, workers: 1, retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
