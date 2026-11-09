import { defineConfig, devices } from '@playwright/test';

/**
 * Task 05.2 administrator deletion notice against a FRESH disposable stack (apps/backend: node scripts/task05-2-browser-stack.cjs → backend :5200
 * on its own loopback PostgreSQL). Run it on its own stack: it enrolls the seeded owner and staff accounts and changes their passwords. Traces and
 * videos stay off because the flows type passwords and one-time codes.
 */
// Defaults match scripts/task05-2-browser-stack.cjs; set TASK05_2_API_PORT / TASK05_2_FRONTEND_PORT together with the stack to run beside another one.
const apiPort = process.env.TASK05_2_API_PORT || '5200';
const frontendPort = process.env.TASK05_2_FRONTEND_PORT || '3200';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'task05-2-admin-deletion-notice-disposable.spec.ts',
  outputDir: './test-results/task05-2-deletion-notice-disposable',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${frontendPort}`,
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: `npm run dev -- --host localhost --port ${frontendPort} --strictPort`,
    url: `http://localhost:${frontendPort}/admin/login`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { E2E_FRONTEND_PORT: frontendPort, E2E_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
  },
});
