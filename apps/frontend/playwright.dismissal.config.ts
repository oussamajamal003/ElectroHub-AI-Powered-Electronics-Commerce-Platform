import { defineConfig } from '@playwright/test';
import original from './playwright.cart.config';

// Build first (`npm run build`). Every journey intercepts APIs before navigation; this owned production preview
// does not start a backend, touch shared DEV, or create session rows.
export default defineConfig({
  ...original,
  testMatch: ['failed-payment-dismissal.spec.ts'],
  outputDir: './test-results/dismissal',
  use: { ...original.use, baseURL: 'http://127.0.0.1:3151' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 3151 --strictPort',
    url: 'http://127.0.0.1:3151', reuseExistingServer: false, timeout: 60000,
  },
});
