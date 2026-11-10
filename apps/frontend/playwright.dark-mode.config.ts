import { defineConfig, devices } from '@playwright/test';

/**
 * Task 06.2 (parallel) premium dark mode. Every /api request is answered by synthetic browser fixtures
 * (tests/visual/darkMode.fixtures.ts): no backend, no DEV database, no payment provider, nothing is mutated.
 *   npx playwright test -c playwright.dark-mode.config.ts                     # all engines
 *   npx playwright test -c playwright.dark-mode.config.ts --project=chromium  # one engine
 * EH_DARK_MODE_CAPTURE=1 also writes light/dark review screenshots to test-results/dark-mode/captures.
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'dark-mode.visual.spec.ts',
  outputDir: './test-results/dark-mode',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.EH_DARK_MODE_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
