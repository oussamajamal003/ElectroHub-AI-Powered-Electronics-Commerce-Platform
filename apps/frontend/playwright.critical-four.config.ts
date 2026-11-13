import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['scoped-themes.spec.ts', 'critical-contact-capture.spec.ts', 'admin-alerts-badge.spec.ts', 'task06-2-account-privacy.spec.ts'],
  grep: /real contact capture|same-browser|category acknowledges only itself|failed acknowledgement|compact width|profile photo UX|responsive matrix|accessibility \(axe/,
  reporter: [['list'], ['json', { outputFile: process.env.CRITICAL_RESULTS_FILE ?? './test-results/critical-four-results.json' }]],
  outputDir: './test-results/critical-four', workers: 1, timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:3262', viewport: { width: 1440, height: 900 }, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3262 --strictPort', url: 'http://127.0.0.1:3262', reuseExistingServer: true },
});
