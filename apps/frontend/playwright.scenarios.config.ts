import { defineConfig } from '@playwright/test';
import original from './playwright.checkout.config';

// Scenarios 2–6: owned production preview only. Every API and Stripe boundary is intercepted before navigation.
export default defineConfig({
  // Generous condition-based deadlines: the shared workstation also runs other owners' processes.
  ...original, timeout: 120000, expect: { timeout: 15000 }, testMatch: ['scenarios-2-6.spec.ts'], outputDir: './test-results/scenarios-2-6',
  reporter: [['list'], ['json', { outputFile: 'test-results/scenarios-2-6/report.json' }]],
  use: { ...original.use, baseURL: 'http://127.0.0.1:3146', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 3146 --strictPort',
    url: 'http://127.0.0.1:3146', reuseExistingServer: false, timeout: 60000 },
});
