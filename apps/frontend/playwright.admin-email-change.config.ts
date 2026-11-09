import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual', testMatch: 'admin-email-change-keyboard.spec.ts', outputDir: './test-results/admin-email-change-keyboard',
  fullyParallel: false, workers: 1, timeout: 45_000, expect: { timeout: 10_000 }, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:6106', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'npm run storybook -- --ci --no-open --port 6106', url: 'http://localhost:6106/iframe.html?id=admin-security-email-change--flow',
    reuseExistingServer: false, timeout: 90_000 },
});
