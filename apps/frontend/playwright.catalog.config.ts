import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/catalog',
  outputDir: './test-results/catalog-visual',
  preserveOutput: 'always',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3101' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3101 --strictPort',
    url: 'http://127.0.0.1:3101', reuseExistingServer: false, timeout: 60_000 },
});
