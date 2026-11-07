import { defineConfig, devices } from '@playwright/test';

/**
 * Task 05.2 addendum: Owner succession (promotion, transfer-and-delete) against a FRESH disposable stack (apps/backend:
 * TASK05_2_API_PORT=5201 TASK05_2_FRONTEND_PORT=3201 node scripts/task05-2-browser-stack.cjs → backend :5201 on its own loopback PostgreSQL). Run it on its own stack: it transfers the seeded
 * ownership and deletes accounts. Traces/videos stay off because the flows type passwords and one-time codes.
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'task05-2-owner-succession-disposable.spec.ts',
  outputDir: './test-results/task05-2-succession-disposable',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3201',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host localhost --port 3201 --strictPort',
    url: 'http://localhost:3201/admin/login',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { E2E_FRONTEND_PORT: '3201', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5201' },
  },
});
