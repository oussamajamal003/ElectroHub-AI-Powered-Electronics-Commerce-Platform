import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'admin-media-live-dev.spec.ts',
  outputDir: './test-results/task04-3-live-dev',
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 120_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3200',
    viewport: { width: 1440, height: 1000 },
    // Auth requests contain credentials. Do not persist traces, videos, or automatic screenshots.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3200',
    url: 'http://127.0.0.1:3200/admin/login',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5200' },
  },
});
