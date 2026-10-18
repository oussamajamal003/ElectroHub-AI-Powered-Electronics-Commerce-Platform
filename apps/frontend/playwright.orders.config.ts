import { defineConfig, devices } from '@playwright/test';

// Task 03.7 Order Management journeys and visual evidence. Build first (`npm run build`): the owned preview serves the
// production bundle; every API read is intercepted with deterministic fixtures (mocked reads — not live DB proof).
export default defineConfig({
  testDir: './tests/orders', outputDir: './test-results/orders-run', preserveOutput: 'always',
  timeout: 60000, workers: 1, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3137', reducedMotion: 'reduce' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 3137 --strictPort', url: 'http://127.0.0.1:3137', reuseExistingServer: false, timeout: 60000 },
});
