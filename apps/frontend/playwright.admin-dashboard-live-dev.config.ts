import { defineConfig, devices } from '@playwright/test';

/**
 * Task 05.1 live admin QA against the already-running local stack (Vite :3000 → backend :5000 → shared Supabase DEV).
 * Opt-in only (EH_RUN_LIVE_ADMIN_DEV=true); it never starts or stops servers.
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'admin-dashboard-live-dev.spec.ts',
  outputDir: './test-results/task05-1-live-dev',
  fullyParallel: false,
  workers: 1,
  timeout: 1_200_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.EH_LIVE_ADMIN_BASE_URL ?? 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 1000 },
    // Auth requests contain credentials. Do not persist traces, videos, or automatic screenshots.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
