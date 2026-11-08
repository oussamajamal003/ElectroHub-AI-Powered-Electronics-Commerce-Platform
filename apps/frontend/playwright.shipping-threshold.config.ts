import { defineConfig, devices } from '@playwright/test';

// Start the disposable task05-2-browser-stack with API 5217 / frontend 3217 first.
export default defineConfig({
  testDir: './tests/visual', testMatch: 'shipping-threshold-disposable.spec.ts', workers: 1,
  timeout: 180_000, expect: { timeout: 20_000 }, reporter: 'list',
  outputDir: './test-results/shipping-threshold',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3217', trace: 'off', video: 'off' },
  webServer: { command: 'npm run dev -- --host localhost --port 3217 --strictPort',
    url: 'http://localhost:3217/admin/login', reuseExistingServer: false, timeout: 90_000,
    env: { E2E_FRONTEND_PORT: '3217', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5217' } },
});
