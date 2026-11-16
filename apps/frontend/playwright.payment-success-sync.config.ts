import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/checkout',
  projects: [
    { name: 'journeys', testMatch: 'payment-success-sync.spec.ts' },
    { name: 'notifications', testMatch: 'payment-toasts.spec.ts', grep: /notification reliability/ },
  ],
  // Overall journey budget includes Chromium startup on the shared workstation.
  // Individual condition deadlines stay bounded; application timeouts are unchanged.
  outputDir: './test-results/payment-success-sync', workers: 1, timeout: 120000,
  expect: { timeout: 8000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/payment-success-sync/report.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3158', trace: 'retain-on-failure' },
  webServer: {
    // Build only this task's verified cache path, never another owner's dist output.
    command: 'npx vite build --outDir ../../.cache/payment-success-sync/dist --emptyOutDir && npm run preview -- --host 127.0.0.1 --port 3158 --strictPort --outDir ../../.cache/payment-success-sync/dist',
    url: 'http://127.0.0.1:3158', reuseExistingServer: false, timeout: 180000,
    env: { E2E_API_PROXY_TARGET: 'http://127.0.0.1:1', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_intercepted_fixture' },
  },
});
