import { defineConfig, devices } from '@playwright/test';

/**
 * Task 06.2 (PR #51 follow-up): admin profile shell, profile photo UX, account pages, Cookie Policy, footer Cookie Settings,
 * Contact reload and contact placeholders. Every /api request is answered in the browser (tests/visual/darkMode.fixtures.ts),
 * so nothing here touches a shared database, private storage or email delivery.
 *
 *   npx playwright test -c playwright.task06-2-account-privacy.config.ts                   # Chromium
 *   ACCOUNT_PRIVACY_ALL_BROWSERS=1 npx playwright test -c playwright.task06-2-account-privacy.config.ts   # + Firefox, WebKit
 */
const port = Number(process.env.ACCOUNT_PRIVACY_PORT ?? 3171);
const all = process.env.ACCOUNT_PRIVACY_ALL_BROWSERS === '1';
export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['task06-2-account-privacy.spec.ts'],
  outputDir: './test-results/task06-2-account-privacy',
  preserveOutput: 'always',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 }, trace: 'off', video: 'off', screenshot: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    ...(all ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
      { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    ] : []),
  ],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: true, timeout: 120_000 },
});
