import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/catalog',
  testMatch: 'wishlist.spec.ts',
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3000',
    viewport: { width: 1920, height: 911 },
    trace: 'on-first-retry',
  },
});
