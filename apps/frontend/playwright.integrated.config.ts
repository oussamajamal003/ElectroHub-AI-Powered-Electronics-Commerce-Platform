import { defineConfig, devices } from '@playwright/test';
/**
 * Fully integrated acceptance: real frontend + real backend + disposable PostgreSQL + real Stripe Test Mode.
 * No API interception and no Stripe.js replacement. Requires the isolated stack (see the Task 03.6 master handoff).
 */
export default defineConfig({ testDir: './tests/integrated', outputDir: './test-results/integrated', preserveOutput: 'always',
  timeout: 240_000, workers: 1, retries: 0, reporter: 'list', expect: { timeout: 20_000 },
  use: { ...devices['Desktop Chrome'], viewport: { width: Number(process.env.INTEGRATED_WIDTH ?? 1280), height: Number(process.env.INTEGRATED_HEIGHT ?? 800) }, baseURL: process.env.INTEGRATED_BASE_URL ?? 'http://127.0.0.1:3120', trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
