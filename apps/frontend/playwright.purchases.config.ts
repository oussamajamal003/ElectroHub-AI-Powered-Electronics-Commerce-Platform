import { defineConfig } from '@playwright/test';
import original from './playwright.cart.config';
export default defineConfig({ ...original, testMatch: ['payment-purchases.spec.ts'], outputDir: './test-results/purchases' });
