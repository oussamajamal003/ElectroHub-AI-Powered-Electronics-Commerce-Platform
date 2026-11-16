import { defineConfig } from '@playwright/test';
import original from './playwright.checkout.config';
export default defineConfig({ ...original, testMatch: ['payment-lifecycle.spec.ts', 'payment-recovery.spec.ts', 'payment-session-isolation.spec.ts', 'checkout-reliability.spec.ts', 'checkout.spec.ts', 'payment-retry.spec.ts', 'payment-processing.spec.ts', 'payment-blocker.spec.ts'],
  outputDir: './test-results/payment-lifecycle',
  use: { ...original.use, baseURL: 'http://127.0.0.1:3129' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3129 --strictPort',
    url: 'http://127.0.0.1:3129', reuseExistingServer: false, timeout: 60000 } });
