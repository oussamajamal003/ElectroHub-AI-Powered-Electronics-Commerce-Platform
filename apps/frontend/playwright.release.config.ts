import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Task 06.1 release-critical suite: the REAL frontend (Vite) → the REAL backend (NODE_ENV=test, hermetic environment) → a DISPOSABLE
 * PostgreSQL with the repository's real migrations (pgvector included). Runs locally and in CI with the same commands:
 *
 *   local:  node apps/backend/scripts/release-e2e-db.cjs start      (pgvector container on 127.0.0.1:55436, WSL Docker on Windows)
 *           npm run test:release --workspace=@electrohub/frontend
 *   CI:     .github/actions/disposable-postgres, then the same npm script (see .github/workflows/ci.yml → "Release E2E").
 *
 * Projects: the full functional suite on Chromium, Firefox and WebKit at 1440×900; the @responsive subset at 390 (WebKit, iPhone-class
 * touch emulation), 768 (Chromium, touch) and 1920 (Firefox). Playwright engines, not branded Chrome/Safari or physical devices.
 * No real provider is reachable from this stack (no Stripe key, no email provider, no AI service): see docs/08_Quality/E2E.md.
 */
const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(configDirectory, '../..');
const apiPort = process.env.RELEASE_E2E_API_PORT ?? '5206';
const frontendPort = process.env.RELEASE_E2E_FRONTEND_PORT ?? '3206';
const supportToken = 'electrohub-release-e2e-support-only';
process.env.E2E_TEST_SUPPORT_TOKEN = supportToken;
const ci = Boolean(process.env.CI);
const responsive = /@responsive/;

export default defineConfig({
  testDir: './tests/release',
  testMatch: '**/*.release.spec.ts',
  outputDir: './test-results/release',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: ci ? 2 : 3,
  // One retry in CI only to classify flakiness (a retried pass is reported as "flaky", never silently green); none locally.
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci
    ? [['list'], ['html', { outputFolder: 'playwright-report/release', open: 'never' }], ['json', { outputFile: 'test-results/release/results.json' }]]
    : [['list'], ['json', { outputFile: 'test-results/release/results.json' }]],
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    // Synthetic, per-run disposable credentials only; traces/screenshots are kept for failures as CI artifacts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-webkit-390', grep: responsive, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'tablet-chromium-768', grep: responsive,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'wide-firefox-1920', grep: responsive, use: { ...devices['Desktop Firefox'], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: [
    {
      command: 'node scripts/release-e2e-stack.cjs',
      cwd: path.join(repositoryRoot, 'apps/backend'),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !ci,
      timeout: 240_000,
      env: { RELEASE_E2E_API_PORT: apiPort, RELEASE_E2E_FRONTEND_PORT: frontendPort, E2E_TEST_SUPPORT_TOKEN: supportToken },
    },
    {
      command: `npx vite --host localhost --port ${frontendPort} --strictPort`,
      cwd: configDirectory,
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: !ci,
      timeout: 120_000,
      env: { E2E_FRONTEND_PORT: frontendPort, E2E_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
    },
  ],
});
