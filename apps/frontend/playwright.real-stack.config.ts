import { defineConfig, devices } from '@playwright/test';

// Task 03.6 real-stack acceptance: the REAL frontend + backend + disposable PostgreSQL + Stripe Test Mode. Nothing is
// intercepted (no page.route, no Stripe.js replacement). The operator starts the stack first; see
// docs/tasks/Phase-03/TASK_03.6_REAL_PAYMENT_POSTGRES_ACCEPTANCE.md. Skipped unless REAL_STACK_FIXTURES is set.
export default defineConfig({
  testDir: './tests/checkout', testMatch: ['real-stack.acceptance.spec.ts'], outputDir: './test-results/real-stack', preserveOutput: 'always',
  timeout: 240000, expect: { timeout: 30000 }, workers: 1, retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/real-stack/report.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: process.env.REAL_STACK_BASE_URL ?? 'http://localhost:5180', trace: 'off', video: 'off', screenshot: 'off' },
});
