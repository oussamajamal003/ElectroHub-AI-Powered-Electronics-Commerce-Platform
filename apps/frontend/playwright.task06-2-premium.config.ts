import { defineConfig, devices } from '@playwright/test';

/**
 * Task 06.2 premium pages / checkout / pagination suite. Every API call is intercepted inside each spec, so nothing here touches a
 * shared database, Stripe or email. PREMIUM_BASE_URL points the suite at an already running build (e.g. to prove a defect on old code).
 * PREMIUM_BROWSERS=chromium,firefox,webkit adds the other engines when their browsers are installed (`npx playwright install firefox webkit`).
 * PREMIUM_CHROMIUM_CHANNEL=chrome (or msedge) drives an installed branded browser instead of Playwright's bundled Chromium.
 */
const external = process.env.PREMIUM_BASE_URL;
const browsers = (process.env.PREMIUM_BROWSERS ?? 'chromium').split(',');
const channel = process.env.PREMIUM_CHROMIUM_CHANNEL;
const device = { chromium: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) }, firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] } as const;
export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['task06-2-*.spec.ts'],
  outputDir: './test-results/task06-2-premium', preserveOutput: 'always', timeout: 90_000, workers: 1, reporter: 'list',
  use: { baseURL: external ?? 'http://127.0.0.1:3162' },
  projects: browsers.map(name => ({ name, use: { ...device[name as keyof typeof device] } })),
  ...(external ? {} : { webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3162 --strictPort', url: 'http://127.0.0.1:3162', reuseExistingServer: true, timeout: 120_000 } }),
});
