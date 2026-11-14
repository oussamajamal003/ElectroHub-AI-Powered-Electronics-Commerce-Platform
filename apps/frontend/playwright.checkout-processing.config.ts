import { defineConfig, devices } from '@playwright/test';

// PR #51 / Task 06.2 WP A: the processing and recovery UX on an owned port. Every API is intercepted by the Stripe harness;
// no backend, shared DEV or provider is contacted. Never reuses a server, so another session's build cannot answer.
export default defineConfig({ testDir: './tests/checkout', testMatch: ['payment-recovery-ux.spec.ts'], outputDir: './test-results/checkout-processing',
  timeout: 60000, workers: 1, reporter: 'list', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3152' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3152 --strictPort', url: 'http://127.0.0.1:3152', reuseExistingServer: false, timeout: 90000,
    // Placeholder shape only: js.stripe.com is intercepted by the harness, so this key never reaches Stripe.
    env: { VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_intercepted_fixture' } } });
