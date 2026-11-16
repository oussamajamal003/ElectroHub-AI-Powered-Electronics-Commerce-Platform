import { defineConfig } from '@playwright/test';
import original from './playwright.checkout.config';

// Owned frontend only. All API and Stripe boundaries are intercepted before navigation.
export default defineConfig({
  ...original, testMatch: ['scenario1-browser.spec.ts', 'payment-purchases.spec.ts'], outputDir: './test-results/scenario1-browser',
  reporter: [['list'], ['json', { outputFile: 'test-results/scenario1-browser/report.json' }]],
  use: { ...original.use, baseURL: 'http://127.0.0.1:3141', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 3141 --strictPort',
    url: 'http://127.0.0.1:3141', reuseExistingServer: false, timeout: 60000 },
});
