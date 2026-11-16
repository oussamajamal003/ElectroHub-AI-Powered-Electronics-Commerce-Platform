import { defineConfig } from '@playwright/test';
import original from './playwright.checkout.config';

// Build first. Production preview: immune to dev-server reloads from concurrent edits. Every API is intercepted.
export default defineConfig({
  ...original, testMatch: ['cart-badge-sync.spec.ts'], outputDir: './test-results/cart-badge', timeout: 90_000,
  use: { ...original.use, baseURL: 'http://127.0.0.1:3151' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 3151 --strictPort', url: 'http://127.0.0.1:3151', reuseExistingServer: false, timeout: 60_000 },
});
