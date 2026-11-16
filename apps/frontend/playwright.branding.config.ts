import { defineConfig, devices } from '@playwright/test';

/**
 * Task 06.2 side task: browser branding, toasts and tooltips. Hermetic by design: the spec intercepts every `/api/**` request, so it
 * needs no backend, database, payment runtime or e-mail provider — only the Vite dev server on its own port.
 *   npx playwright test -c playwright.branding.config.ts
 * Restrict engines with --project (chromium | firefox | webkit | mobile-chromium-390).
 */
const PORT = 3107;
export default defineConfig({
  testDir: './tests/branding',
  testMatch: '**/*.branding.spec.ts',
  outputDir: './test-results/branding',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/branding', open: 'never' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-chromium-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 800 } } },
    { name: 'mobile-chromium-320', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 800 } } },
  ],
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 60_000 },
});
