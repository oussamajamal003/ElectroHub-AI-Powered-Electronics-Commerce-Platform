import { defineConfig, devices } from '@playwright/test';

// Mocked Task 04.4 recommendation UI. Every /api request is intercepted by the spec, and the Vite proxy points at a
// loopback port that nothing listens on, so no real backend is reachable from this run.
export default defineConfig({
  testDir: './tests/task04',
  testMatch: 'recommendations.spec.ts',
  outputDir: './test-results/task04-recommendations',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3404',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3404 --strictPort',
    url: 'http://127.0.0.1:3404',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_FRONTEND_PORT: '3404', E2E_API_PROXY_TARGET: 'http://127.0.0.1:59999' },
  },
});
