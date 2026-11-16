import { defineConfig } from '@playwright/test';
import scenarios from './playwright.scenarios.config';
// Header badge hydration on the owned production preview (port 3146); all APIs intercepted.
export default defineConfig({ ...scenarios, testMatch: ['header-badges.spec.ts'], outputDir: './test-results/header-badges',
  reporter: [['list'], ['json', { outputFile: 'test-results/header-badges/report.json' }]] });
