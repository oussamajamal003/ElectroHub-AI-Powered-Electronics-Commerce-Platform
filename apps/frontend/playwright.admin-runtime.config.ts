import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/visual', testMatch: 'admin-runtime-disposable.spec.ts', workers: 1, timeout: 180000,
  expect: { timeout: 20000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://localhost:3288', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'npm run dev -- --host localhost --port 3288 --strictPort', url: 'http://localhost:3288/admin/login',
    reuseExistingServer: false, timeout: 90000, env: { E2E_FRONTEND_PORT: '3288', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5288' } },
});
