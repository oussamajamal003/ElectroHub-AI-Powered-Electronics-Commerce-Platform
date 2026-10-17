import { defineConfig, devices } from '@playwright/test';

// Uses the frontend dev server (proxying /api to the local backend) so product data is real.
// Cart add/read calls are intercepted with controlled latency to isolate frontend waiting from server time.
export default defineConfig({
  testDir: './tests/checkout',
  testMatch: ['add-to-cart-latency.spec.ts'],
  outputDir: './test-results/add-to-cart',
  timeout: 90000,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run dev -- --port 3000 --strictPort', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120000 },
});
