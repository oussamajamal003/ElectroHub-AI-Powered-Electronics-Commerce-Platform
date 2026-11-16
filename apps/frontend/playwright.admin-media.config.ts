import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['admin-media.visual.spec.ts', 'customer-product-media.visual.spec.ts'],
  outputDir: './test-results/task04-3-media',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3200',
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 3200',
    url: 'http://localhost:3200',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://localhost:5200' },
  },
});
