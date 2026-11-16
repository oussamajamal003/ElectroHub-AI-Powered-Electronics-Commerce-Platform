import { defineConfig, devices } from '@playwright/test';

/**
 * Task 03.6 isolated payment stack (frontend :3200 -> backend :5200 -> disposable PostgreSQL). Starts no servers: the isolated stack must
 * already be running. A private runtime handshake verifies the backend and frontend proxy both reach the same
 * TLS-verified disposable runtime before any fixture-dependent test runs. Never targets shared DEV.
 */
export default defineConfig({
  testDir: './tests/isolated',
  testMatch: '**/*.isolated.spec.ts',
  globalSetup: './tests/isolated/global-setup.ts',
  outputDir: './test-results/isolated',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  // Authenticated fixtures and the private runtime handshake must not enter retained traces.
  use: { ...devices['Desktop Chrome'], trace: 'off' },
});
