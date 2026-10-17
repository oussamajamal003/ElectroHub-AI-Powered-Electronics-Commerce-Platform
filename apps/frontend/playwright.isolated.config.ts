import { defineConfig, devices } from '@playwright/test';

/**
 * Task 03.6 isolated payment stack (frontend :3200 -> backend :5200 -> disposable PostgreSQL). Starts no servers: the isolated stack must
 * already be running and its backend must log `payment.isolation.resolved target=disposable`. Never targets shared DEV.
 */
export default defineConfig({
  testDir: './tests/isolated',
  testMatch: '**/*.isolated.spec.ts',
  outputDir: './test-results/isolated',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
