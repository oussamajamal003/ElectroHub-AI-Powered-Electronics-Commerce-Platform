import { test, expect, type Page } from '@playwright/test';
import { cart } from '../../src/features/checkout/fixtures';

// Controlled cart latency (ms). POST = the add itself; GET = a cart read that also runs on failure.
const POST_MS = 1500;
const GET_MS = 3000;
// A prompt control returns within the add's own latency plus a small UI allowance.
const PROMPT_LIMIT_MS = POST_MS + 1000;

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'checkout-demo@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
const pages = [
  { name: 'Products card', path: '/products', button: 'Add Apple Watch SE 2 40mm GPS — Silver to cart' },
  { name: 'Product Details', path: '/products/apple-watch-se-2-40mm-gps-silver', button: 'Add to Cart' },
];
const viewports = [{ name: '390', width: 390, height: 844 }, { name: '1366', width: 1366, height: 768 }];

interface Counters { post: number; get: number; mode: 'success' | 'failure'; postAt?: number }

async function signedIn(page: Page, counters: Counters) {
  await page.addInitScript(u => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(u)); }, user);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user } });
    if (path.startsWith('/api/auth/')) return route.fulfill({ json: { accessToken: 'intercepted-token', user } });
    if (path === '/api/wishlist') return route.fulfill({ json: { data: { items: [], totalItems: 0 } } });
    if (path === '/api/cart' && request.method() === 'GET') {
      counters.get++;
      await wait(GET_MS);
      return route.fulfill({ json: { data: { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false } } });
    }
    if (path === '/api/cart/items' && request.method() === 'POST') {
      counters.post++; counters.postAt = Date.now();
      await wait(POST_MS);
      if (counters.mode === 'failure') return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal error' } } });
      return route.fulfill({ json: { data: { ...cart, totalQuantity: 1 } } });
    }
    return route.continue();
  });
}

for (const target of pages) for (const viewport of viewports) {
  test.describe(`${target.name} ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('success: button returns once the add is confirmed, without an extra cart read', async ({ page }) => {
      const counters: Counters = { post: 0, get: 0, mode: 'success' };
      await signedIn(page, counters);
      await page.goto(target.path);
      const button = page.getByRole('button', { name: target.button, exact: target.name === 'Product Details' }).first();
      await expect(button).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(400);
      const getsBefore = counters.get;
      const started = Date.now();
      await button.click();
      await expect(button).toBeDisabled();
      await expect(button).toBeEnabled({ timeout: 20000 });
      const elapsed = Date.now() - started;
      console.log(`[${target.name} ${viewport.name}px] success: ${elapsed}ms (click->POST arrival ${(counters.postAt ?? 0) - started}ms, POST-to-enabled ${Date.now() - (counters.postAt ?? Date.now())}ms, POST ${counters.post}, extra GET ${counters.get - getsBefore})`);
      expect(counters.post).toBe(1);
      expect(elapsed).toBeLessThan(PROMPT_LIMIT_MS);
      expect(counters.get - getsBefore).toBe(0);
    });

    test('failure: button returns and a recoverable error shows without waiting for a cart read', async ({ page }) => {
      const counters: Counters = { post: 0, get: 0, mode: 'failure' };
      await signedIn(page, counters);
      await page.goto(target.path);
      const button = page.getByRole('button', { name: target.button, exact: target.name === 'Product Details' }).first();
      await expect(button).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(400);
      const started = Date.now();
      await button.click();
      await expect(button).toBeDisabled();
      await expect(button).toBeEnabled({ timeout: 20000 });
      const elapsed = Date.now() - started;
      console.log(`[${target.name} ${viewport.name}px] failure: ${elapsed}ms (POST ${counters.post}, GET ${counters.get})`);
      expect(elapsed).toBeLessThan(PROMPT_LIMIT_MS);
      expect(counters.post).toBe(1);
      if (target.name === 'Product Details') await expect(page.getByText('Could not add this product')).toBeVisible();
      else { await expect(button).toHaveText(/Try again/); await expect(page.getByText('Could not add item. Please try again.')).toBeVisible(); }
    });

    test('double click sends exactly one add', async ({ page }) => {
      const counters: Counters = { post: 0, get: 0, mode: 'success' };
      await signedIn(page, counters);
      await page.goto(target.path);
      const button = page.getByRole('button', { name: target.button, exact: target.name === 'Product Details' }).first();
      await expect(button).toBeEnabled({ timeout: 30000 });
      await page.waitForTimeout(400);
      await button.dblclick();
      await expect(button).toBeDisabled();
      await expect(button).toBeEnabled({ timeout: 20000 });
      await page.waitForTimeout(500);
      expect(counters.post).toBe(1);
    });
  });
}

test.describe('navigation during an add', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('leaving the page mid-add still applies the confirmed add to the Cart count, with no error', async ({ page }) => {
    const counters: Counters = { post: 0, get: 0, mode: 'success' };
    await signedIn(page, counters);
    await page.goto('/products');
    const button = page.getByRole('button', { name: 'Add Apple Watch SE 2 40mm GPS — Silver to cart' });
    await expect(button).toBeEnabled({ timeout: 30000 });
    await button.click();
    await page.getByRole('link', { name: /^Cart/ }).first().click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible({ timeout: 20000 });
    expect(counters.post).toBe(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
