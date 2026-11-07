import { defineConfig, devices } from '@playwright/test';

/**
 * Task 05.2 addendum: Administrators page access (restricted screen, hidden entry, mid-session removal) against a FRESH disposable stack (apps/backend:
 * TASK05_2_API_PORT=5204 TASK05_2_FRONTEND_PORT=3204 node scripts/task05-2-browser-stack.cjs → backend :5204 on its own loopback PostgreSQL). Run it on its own stack: it enrolls the seeded Owner and staff
 * accounts and changes the staff account's management access. Traces/videos stay off because the flows type passwords and one-time codes.
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'task05-2-administrators-access-disposable.spec.ts',
  outputDir: './test-results/task05-2-administrators-access-disposable',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3204',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host localhost --port 3204 --strictPort',
    url: 'http://localhost:3204/admin/login',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { E2E_FRONTEND_PORT: '3204', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5204' },
  },
});
