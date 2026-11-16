import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 06.2 side task: scroll motion, Contact/About, admin alerts badge and Cart checkout readiness.
 * Every API is intercepted, so nothing here touches a shared database or sends email.
 * MOTION_BASE_URL points the suite at an already running build (used to prove the pre-fix defect against the previous code).
 */
const external = process.env.MOTION_BASE_URL;
// MOTION_BROWSER=firefox|webkit runs the same specs in another engine (Work Package C browser coverage); Chromium by default.
const engines = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] } as const;
const engine = engines[(process.env.MOTION_BROWSER ?? 'chromium') as keyof typeof engines] ?? engines.chromium;
export default defineConfig({
  testDir: './tests/visual', testMatch: ['scroll-motion.spec.ts', 'motion-replay.spec.ts', 'product-description.spec.ts', 'pdp-scroll-motion.spec.ts', 'contact-about.spec.ts', 'admin-alerts-badge.spec.ts', 'cart-checkout-readiness.spec.ts'],
  outputDir: `./test-results/motion-contact${process.env.MOTION_BROWSER ? `-${process.env.MOTION_BROWSER}` : ''}`, preserveOutput: 'always', timeout: 90_000, workers: 1, reporter: 'list',
  // Lazy route chunks compile on first request under the Vite dev server; 15s absorbs that cold start without hiding real waits.
  expect: { timeout: 15_000 },
  use: { ...engine, baseURL: external ?? 'http://127.0.0.1:3161' },
  ...(external ? {} : { webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3161 --strictPort', url: 'http://127.0.0.1:3161', reuseExistingServer: true, timeout: 90_000 } }),
});
