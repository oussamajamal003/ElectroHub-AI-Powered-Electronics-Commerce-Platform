import { defineConfig, devices } from '@playwright/test';
// CHECKOUT_PORT runs the intercepted suite on its own dev server when 3115 is already taken by another checkout's server.
const port = process.env.CHECKOUT_PORT ?? '3115';
export default defineConfig({ testDir: './tests/checkout', outputDir: './test-results/checkout', preserveOutput: 'always',
  timeout: 60000, workers: 1, reporter: 'list', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}` },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: true, timeout: 60000 } });
