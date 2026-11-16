import { defineConfig, devices } from '@playwright/test';

/**
 * PR #51 / Task 06.2 WP C + WP D: Product Description layout and account loading skeletons on an owned port (never reuses a server).
 * Every /api request is answered in the browser (tests/visual/darkMode.fixtures.ts): no backend, shared database or provider.
 *
 *   npx playwright test -c playwright.task06-2-description-skeletons.config.ts                                     # Chromium
 *   DESCRIPTION_SKELETONS_ALL_BROWSERS=1 npx playwright test -c playwright.task06-2-description-skeletons.config.ts   # + Firefox, WebKit
 */
const port = Number(process.env.DESCRIPTION_SKELETONS_PORT ?? 3173);
const all = process.env.DESCRIPTION_SKELETONS_ALL_BROWSERS === '1';
export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['task06-2-description-skeletons.spec.ts'],
  outputDir: './test-results/task06-2-description-skeletons',
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
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120_000 },
});
