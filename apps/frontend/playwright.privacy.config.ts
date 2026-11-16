import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/privacy', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4180' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
