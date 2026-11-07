import { defineConfig, devices } from '@playwright/test';

// Only the isolated loopback QA backend; never the shared DEV frontend.
export default defineConfig({
  testDir: './tests/visual', testMatch: 'auth-keyboard-disposable.spec.ts',
  outputDir: './test-results/auth-keyboard', workers: 1, timeout: 120_000,
  expect: { timeout: 15_000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3200',
    trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: 'npm run dev -- --host localhost --port 3200 --strictPort',
    url: 'http://localhost:3200/admin/login', reuseExistingServer: false,
    env: { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5200' },
  },
});
