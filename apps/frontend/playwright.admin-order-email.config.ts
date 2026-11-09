import { defineConfig, devices } from '@playwright/test';

/** Focused Admin Orders email deep-link flow; all authentication and order API responses are isolated synthetic fixtures. */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'admin-order-email-navigation.spec.ts',
  outputDir: './test-results/admin-order-email-navigation',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.EH_ADMIN_ORDER_EMAIL_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 960 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/admin/login',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
