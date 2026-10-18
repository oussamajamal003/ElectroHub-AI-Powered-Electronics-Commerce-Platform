import { expect, test, type Page } from '@playwright/test';
import { orderDetails, orderSummary, ordersPage } from '../../src/features/orders/fixtures';

// Global UI refinement pass — reusable visual captures at 390 / 768 / 1440.
// Public catalog pages use the running local backend; signed-in surfaces use intercepted, synthetic API reads.
const SHOTS = 'playwright-report/refinement'; // outside test-results so a later run's cleanup keeps them
const WIDTHS = [390, 768, 1440] as const;
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'refine-demo@example.invalid', firstName: 'Jordan', lastName: 'Lee', role: 'CUSTOMER' };

async function signedIn(page: Page) {
  await page.addInitScript(value => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)); }, user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === '/api/auth/logout') return send({ message: 'Logged out' });
    if (path.startsWith('/api/auth/')) return path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'intercepted-refine-token', user });
    if (path === '/api/cart') return send({ data: { revision: 'a'.repeat(64), items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === '/api/checkout/payment-attempts') return send({ data: [] });
    if (path === '/api/orders') return send(ordersPage([orderSummary(0), orderSummary(1)], 1, 2));
    if (/^\/api\/orders\/[^/]+$/.test(path)) return send({ data: orderDetails() });
    return route.continue();
  });
}

for (const width of WIDTHS) {
  test.describe(`refinement @ ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('home: header, hero, promo banners, arrivals, footer', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'New Arrivals' })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `${SHOTS}/home-top-${width}.png` });
      const promo = page.getByRole('region', { name: 'Explore electronics' });
      await promo.scrollIntoViewIfNeeded();
      await expect(promo.locator('article').first()).toBeVisible({ timeout: 30000 });
      // The product photo is the banner background (absolutely positioned behind the copy), not a boxed image.
      const bg = promo.locator('article img').first();
      expect(await bg.evaluate(element => getComputedStyle(element).position)).toBe('absolute');
      await promo.screenshot({ path: `${SHOTS}/home-promos-${width}.png` });
      await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/home-footer-${width}.png` });
      await page.screenshot({ path: `${SHOTS}/home-full-${width}.png`, fullPage: true });
    });

    test('products: auto-filtering persists in the URL across refresh', async ({ page }) => {
      await page.goto('/products');
      await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `${SHOTS}/products-${width}.png` });
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Apply filters' })).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Availability' }).click();
      await page.getByRole('option', { name: 'Available', exact: true }).click();
      await expect(page).toHaveURL(/availability=available/);
      await page.getByRole('combobox', { name: 'Sort by' }).click();
      await page.getByRole('option', { name: 'Price: high to low' }).click();
      await expect(page).toHaveURL(/sort=price-desc/);
      await page.screenshot({ path: `${SHOTS}/filters-open-${width}.png` });
      await page.reload();
      await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText('Price: high to low');
      await expect(page.getByRole('button', { name: /Remove availability filter/ })).toBeVisible();
      await page.getByRole('button', { name: 'Clear all', exact: true }).click();
      await expect(page).not.toHaveURL(/availability=/);
      await page.goto('/products?q=zzzzunlikely');
      await expect(page.getByRole('heading', { name: /No results for/ })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `${SHOTS}/products-empty-${width}.png` });
    });

    test('product details: description sits between price and stock', async ({ page }) => {
      await page.goto('/products');
      const first = page.getByTestId('product-card').first();
      await expect(first).toBeVisible({ timeout: 30000 });
      await first.getByRole('heading').getByRole('link').click();
      const description = page.getByTestId('product-description');
      await expect(description).toBeVisible({ timeout: 30000 });
      const [priceBox, descriptionBox, qtyBox] = await Promise.all([
        page.locator('section[aria-labelledby="product-title"] strong').first().boundingBox(),
        description.boundingBox(), page.getByText('Qty', { exact: true }).boundingBox()]);
      expect(descriptionBox!.y).toBeGreaterThan(priceBox!.y);
      expect(qtyBox!.y).toBeGreaterThan(descriptionBox!.y);
      await page.screenshot({ path: `${SHOTS}/product-details-${width}.png` });
    });

    test('orders and account surfaces (synthetic data)', async ({ page }) => {
      await signedIn(page);
      await page.goto('/orders');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `${SHOTS}/orders-${width}.png`, fullPage: true });
      await page.goto('/account');
      await expect(page.getByRole('heading', { name: 'Recent Orders' })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `${SHOTS}/account-${width}.png`, fullPage: true });
    });
  });
}

test('loading and error states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/search/products?**', async route => { await new Promise(resolve => setTimeout(resolve, 4000)); await route.continue(); });
  await page.goto('/products');
  await expect(page.getByText('Searching products…')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/products-loading-1440.png` });
  await page.unroute('**/api/search/products?**');
  await page.route('**/api/search/products?**', route => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'x' } } }));
  await page.goto('/products?q=error-state');
  await expect(page.getByRole('heading', { name: 'Search unavailable' })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/products-error-1440.png` });
});

test('sign out redirects home with a confirmation toast', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedIn(page);
  await page.goto('/orders');
  await page.getByRole('button', { name: /Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Signed out successfully.')).toBeVisible();
  await expect(page.locator('#home-title')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(600); // let the toast finish its entrance
  await page.screenshot({ path: `${SHOTS}/signed-out-toast-1440.png` });
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});
