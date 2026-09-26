import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(configDirectory, '../..');
const outboxDirectory = path.resolve(configDirectory, 'test-results/auth-outbox');
const e2eSupportToken = 'electrohub-e2e-support-only';
process.env.E2E_TEST_SUPPORT_TOKEN = e2eSupportToken;
const backendPort = process.env.E2E_AUTH_BACKEND_PORT ?? '5202';
const frontendPort = process.env.E2E_AUTH_FRONTEND_PORT ?? '3202';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.101' } } },
    { name: 'mobile-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.102' } } },
  ],
  webServer: [
    {
      command: 'node --import tsx src/server.ts',
      cwd: path.resolve(repositoryRoot, 'apps/backend'),
      url: `http://localhost:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: 'test', PORT: backendPort, E2E_OTP_OUTBOX_DIR: outboxDirectory, E2E_TEST_SUPPORT_TOKEN: e2eSupportToken },
    },
    {
      command: 'npm run dev:frontend',
      cwd: repositoryRoot,
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_FRONTEND_PORT: frontendPort, E2E_API_PROXY_TARGET: `http://localhost:${backendPort}` },
    },
  ],
});
