import { defineConfig } from '@playwright/test';
import original from './playwright.checkout.config';

// Build first. Every selected journey intercepts APIs before navigation;
// this owned preview does not start a backend or payment worker.
export default defineConfig({
  ...original,
  testMatch: ['cart-availability.spec.ts', 'payment-retry.spec.ts'],
  outputDir: './test-results/cart-reliability',
  use: { ...original.use, baseURL: 'http://127.0.0.1:3127' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 3127 --strictPort',
    url: 'http://127.0.0.1:3127', reuseExistingServer: false, timeout: 60000,
  },
});
