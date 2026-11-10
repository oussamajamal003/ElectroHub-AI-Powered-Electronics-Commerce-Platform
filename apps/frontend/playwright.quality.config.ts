import { defineConfig, devices } from '@playwright/test';
import release from './playwright.release.config';

// Reuse the hermetic real-backend stack; keep reports separate from 06.1 evidence.
export default defineConfig({
  ...release,
  testDir: './tests/quality',
  testMatch: '**/*.quality.spec.ts',
  outputDir: './test-results/quality',
  workers: 1,
  retries: 0,
  webServer: (Array.isArray(release.webServer) ? release.webServer : [release.webServer!]).map(server => ({ ...server, reuseExistingServer: false })),
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/quality', open: 'never' }],
    ['json', { outputFile: 'test-results/quality/results.json' }]],
  projects: [
    ...release.projects!,
    { name: 'mobile-chromium-320', grep: /@responsive/, use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 800 } } },
    { name: 'tablet-firefox-1024', grep: /@responsive/, use: { ...devices['Desktop Firefox'], viewport: { width: 1024, height: 768 } } },
  ],
});
