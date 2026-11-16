import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Task 05.1 closure and premium-UI checks against the DISPOSABLE delivery QA stack (apps/backend/scripts/delivery-qa-stack.cjs), never shared DEV.
 * Opt-in: EH_QA_STACK_STATE=<run>/state.json. It never starts or stops servers.
 */
const statePath = process.env.EH_QA_STACK_STATE;
const state = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) as { frontend: string } : null;

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /admin-(closure|premium)-disposable\.spec\.ts/,
  outputDir: './test-results/task05-1-closure',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: state?.frontend ?? 'http://localhost:3310',
    viewport: { width: 1440, height: 1000 },
    // Login requests carry the stack's generated test credentials: no traces, videos or automatic screenshots.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
