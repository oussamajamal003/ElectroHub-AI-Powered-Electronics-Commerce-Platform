import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/storybook',
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:6006' },
  webServer: { command: 'npx storybook dev --port 6006 --host 127.0.0.1 --no-open --ci',
    url: 'http://127.0.0.1:6006', reuseExistingServer: false, timeout: 120_000 },
});
