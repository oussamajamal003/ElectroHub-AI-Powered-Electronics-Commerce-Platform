import { defineConfig, devices } from '@playwright/test';

/** Task 05.2 live smoke against the already-running localhost:3000 (shared DEV through the local backend). Starts no server. */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'task05-2-live-dev.spec.ts',
  outputDir: './test-results/task05-2-live-dev',
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, trace: 'off', video: 'off', screenshot: 'off' },
});
