import { defineConfig, devices } from '@playwright/test';

// One genuine MAIN_DEV Test Mode order; retries and tracing are disabled, and a private progress marker prevents repeat submission.
// PowerShell run command (only after explicit purchase approval): $env:TASK04_DEV_PURCHASE_APPROVED='1'; npx playwright test -c playwright.task04.config.ts
export default defineConfig({
  testDir: './tests/task04',
  testMatch: '**/*.spec.ts',
  // The Task 04.4 recommendations spec is fully mocked and runs from playwright.recommendations.config.ts.
  testIgnore: 'recommendations.spec.ts',
  globalSetup: './tests/task04/global-setup.ts',
  outputDir: './test-results/task04-dev',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    acceptDownloads: true,
  },
});
