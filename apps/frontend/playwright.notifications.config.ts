import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/notifications', outputDir: './test-results/notifications', workers: 1, timeout: 60000,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:3149', reducedMotion: 'reduce', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.NOTIFICATION_QA_CHROME_CHANNEL === 'chrome' ? { channel: 'chrome' } : {}) } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 3149 --strictPort', url: 'http://127.0.0.1:3149', reuseExistingServer: false },
});
