import { defineConfig, devices } from '@playwright/test';

/**
 * Task 04.5 delivery tracking real-browser QA. Starts no servers: run `node scripts/delivery-qa-stack.cjs` in apps/backend first (disposable
 * PostgreSQL + seeded fixtures + backend :5310 + Vite :3310). The spec reads that stack's state file and skips when it is absent.
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['delivery-tracking.visual.spec.ts', 'delivery-map.visual.spec.ts'],
  outputDir: './test-results/delivery-tracking',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  // Authenticated fixtures must not enter retained traces.
  use: { ...devices['Desktop Chrome'], trace: 'off', viewport: { width: 1440, height: 900 } },
});
