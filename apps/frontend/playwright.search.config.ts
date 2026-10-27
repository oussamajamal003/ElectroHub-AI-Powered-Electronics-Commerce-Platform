import { defineConfig } from '@playwright/test';
// The closure run can reuse this suite against disposable QA without routing through MAIN DEV.
const baseURL = process.env.SEARCH_BASE_URL ?? 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1):(3000|3200)$/.test(baseURL)) throw new Error('Search browser tests require a local development or isolated QA origin.');
const isolated = new URL(baseURL).port === '3200';
export default defineConfig({
  testDir: './tests/search', timeout: 120000, workers: 1, retries: 0,
  outputDir: './test-results/search',
  ...(isolated ? { globalSetup: './tests/isolated/global-setup.ts' } : {}),
  reporter: [['list']],
  use: { baseURL, browserName: 'chromium', trace: isolated ? 'off' : 'retain-on-failure', screenshot: 'only-on-failure' },
});
