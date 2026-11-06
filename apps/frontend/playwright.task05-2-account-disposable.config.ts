import { defineConfig, devices } from '@playwright/test';

/**
 * Task 05.2 addendum: Admin Profile Change Password and Danger Zone against a FRESH disposable stack (apps/backend: node
 * scripts/task05-2-browser-stack.cjs → backend :5200 on its own loopback PostgreSQL). Run it on its own stack: it changes the seeded
 * owner's password and deletes the invited administrator. Traces/videos stay off because the flows type passwords and one-time codes.
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'task05-2-admin-account-disposable.spec.ts',
  outputDir: './test-results/task05-2-account-disposable',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3200',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host localhost --port 3200 --strictPort',
    url: 'http://localhost:3200/admin/login',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5200' },
  },
});
