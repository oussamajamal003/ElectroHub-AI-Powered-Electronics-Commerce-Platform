import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual', testMatch: 'admin-email-change-disposable.spec.ts', outputDir: './test-results/admin-email-change-disposable',
  fullyParallel: false, workers: 1, timeout: 300_000, expect: { timeout: 20_000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3300', viewport: { width: 1440, height: 1000 },
    trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'npm run dev -- --host localhost --port 3300 --strictPort', url: 'http://localhost:3300/admin/login',
    reuseExistingServer: false, timeout: 90_000,
    env: { E2E_FRONTEND_PORT: '3300', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5300' } },
});
