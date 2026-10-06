import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './tests/checkout', outputDir: './test-results/checkout', preserveOutput: 'always',
  timeout: 60000, workers: 1, reporter: 'list', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3115' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3115 --strictPort', url: 'http://127.0.0.1:3115', reuseExistingServer: false, timeout: 60000 } });
