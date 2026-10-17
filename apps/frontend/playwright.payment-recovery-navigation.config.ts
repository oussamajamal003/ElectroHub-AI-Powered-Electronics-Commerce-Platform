import { defineConfig } from '@playwright/test';
import base from './playwright.payment-success-sync.config';

export default defineConfig({ ...base,
  projects: [{ name: 'recovery-navigation', testMatch: 'payment-recovery-navigation.spec.ts' }],
  outputDir: './test-results/payment-recovery-navigation',
  reporter: [['list'], ['json', { outputFile: 'test-results/payment-recovery-navigation/report.json' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3159' },
  webServer: {
    command: 'npx vite build --outDir ../../.cache/payment-lifecycle-followup/dist --emptyOutDir && npm run preview -- --host 127.0.0.1 --port 3159 --strictPort --outDir ../../.cache/payment-lifecycle-followup/dist',
    url: 'http://127.0.0.1:3159', reuseExistingServer: false, timeout: 180000,
    env: { E2E_API_PROXY_TARGET: 'http://127.0.0.1:1', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_intercepted_fixture' },
  },
});
