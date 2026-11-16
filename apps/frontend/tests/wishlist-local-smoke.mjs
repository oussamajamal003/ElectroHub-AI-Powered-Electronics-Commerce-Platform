import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.WISHLIST_SMOKE_URL ?? 'http://127.0.0.1:3102';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const evidence = { baseURL, intercepted: false, endpoints: [], unexpectedErrors: [], guestFlow: 'NOT VERIFIED', authenticatedPersistence: 'NOT VERIFIED — no test credentials supplied' };
let stage = 'API readiness';
page.on('pageerror', error => evidence.unexpectedErrors.push(error.message));
page.on('response', response => { if (response.status() >= 500 && new URL(response.url()).pathname.startsWith('/api/')) evidence.unexpectedErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
try {
  for (const endpoint of ['/api/wishlist', '/api/wishlist/validate', '/api/search/products?page=1&pageSize=2']) {
    const started = Date.now();
    try {
      const response = endpoint.endsWith('/validate') ? await page.request.post(`${baseURL}${endpoint}`, { data: { productIds: [] }, timeout: 35000 }) : await page.request.get(`${baseURL}${endpoint}`, { timeout: 35000 });
      evidence.endpoints.push({ endpoint, status: response.status(), durationMs: Date.now() - started });
    } catch { evidence.endpoints.push({ endpoint, status: 'CONNECTION/TIMEOUT', durationMs: Date.now() - started }); }
  }
  stage = 'guest empty page'; await page.goto(`${baseURL}/wishlist`);
  await page.getByRole('heading', { name: 'Your wishlist is empty' }).waitFor({ timeout: 15000 });
  stage = 'real catalog availability'; await page.getByRole('link', { name: 'Explore Products' }).click();
  const heart = page.getByRole('button', { name: /Add .* to wishlist/ }).first();
  await heart.waitFor({ timeout: 40000 }); stage = 'guest save and hydration'; await heart.click();
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await page.waitForURL(`${baseURL}/wishlist`);
  await page.getByRole('heading', { name: 'Wishlist', exact: true }).waitFor();
  await page.locator('[data-testid="product-card"]').waitFor({ timeout: 40000 });
  stage = 'guest refresh persistence'; await page.reload(); await page.locator('[data-testid="product-card"]').waitFor({ timeout: 40000 });
  await page.screenshot({ path: 'test-results/wishlist-real-localhost.png', fullPage: true });
  stage = 'guest removal'; await page.getByRole('button', { name: /Remove .* from wishlist/ }).click();
  await page.getByRole('heading', { name: 'Your wishlist is empty' }).waitFor();
  evidence.guestFlow = 'PASS — real catalog save, hydration, refresh, remove';
} catch (error) { evidence.guestFlow = `FAIL — ${stage}`; console.error(error instanceof Error ? error.message : 'Smoke failed'); await page.screenshot({ path: 'test-results/wishlist-real-localhost-failure.png', fullPage: true }); process.exitCode = 1; }
finally {
  await writeFile('test-results/wishlist-real-localhost.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
}
