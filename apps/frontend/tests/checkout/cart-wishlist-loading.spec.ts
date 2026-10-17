import { expect, test, type Page, type Route } from '@playwright/test';
import { harness } from './stripe.harness';
import { cart } from '../../src/features/checkout/fixtures';
import { wishlistProduct } from '../../src/features/wishlist/fixtures';

// INTERCEPTED APIs (real Chromium, real app routing/components). Proves loading-state transitions only.
const emptyCart = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
const savedWishlist = { items: [{ productId: wishlistProduct.id, product: { ...wishlistProduct, purchasable: true, availableQuantity: 10, stockStatus: 'IN_STOCK' }, availability: 'AVAILABLE' }], totalItems: 1 };
const pages = {
  cart: { path: '/cart', skeleton: 'Loading cart', api: '**/api/cart', content: cart.items[0]!.product!.name, empty: 'Your cart is empty', error: 'Unable to load your cart', populated: cart, emptyData: emptyCart },
  wishlist: { path: '/wishlist', skeleton: 'Loading wishlist', api: '**/api/wishlist', content: wishlistProduct.name, empty: 'Your wishlist is empty', error: 'Unable to load your wishlist', populated: savedWishlist, emptyData: { items: [], totalItems: 0 } },
} as const;
// Warm the dev server once so timings measure the app, not the first module compile.
test.beforeAll(async ({ browser }) => { const warm = await browser.newPage(); await warm.goto('/cart', { timeout: 60_000 }); await warm.close(); });
type Outcome = { status: number; json?: unknown } | 'network' | 'hang';
async function respond(route: Route, outcome: Outcome) {
  if (outcome === 'hang') return; // never settles: a genuinely slow backend
  if (outcome === 'network') return route.abort('failed');
  return route.fulfill({ status: outcome.status, json: outcome.json ?? { error: { code: 'PAYMENT_UNAVAILABLE', message: 'Unavailable' } } });
}
/** Session refresh outcome is controlled; every other API comes from the harness. Returns refresh call count. */
async function withSession(page: Page, refresh: () => Outcome | null) {
  await harness(page);
  const calls = { refresh: 0 };
  await page.route('**/api/auth/refresh', async route => { calls.refresh++; const outcome = refresh(); return outcome ? respond(route, outcome) : route.fallback(); });
  return calls;
}

for (const [name, screen] of Object.entries(pages)) {
  test.describe(`${name}: every settled response leaves the skeleton`, () => {
    test('fast success shows content', async ({ page }) => {
      await withSession(page, () => null);
      await page.route(screen.api, route => route.request().method() === 'GET' ? route.fulfill({ json: { data: screen.populated } }) : route.fallback());
      await page.goto(screen.path);
      await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0);
    });
    test('authoritative empty result shows the designed empty state', async ({ page }) => {
      await withSession(page, () => null);
      await page.route(screen.api, route => route.request().method() === 'GET' ? route.fulfill({ json: { data: screen.emptyData } }) : route.fallback());
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { name: screen.empty })).toBeVisible();
      await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0);
    });
    test('slow success stays truthfully loading, then shows content', async ({ page }) => {
      await withSession(page, () => null);
      let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(screen.api, async route => { if (route.request().method() !== 'GET') return route.fallback(); await held; return route.fulfill({ json: { data: screen.populated } }); });
      await page.goto(screen.path);
      await expect(page.getByRole('status', { name: screen.skeleton })).toBeVisible();
      await page.waitForTimeout(3_000);
      await expect(page.getByRole('status', { name: screen.skeleton })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      release();
      await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0);
    });
    for (const [label, outcome] of [['HTTP 503', { status: 503 }], ['HTTP 500', { status: 500 }], ['network failure', 'network']] as const) {
      test(`${label} from the ${name} read exits to an actionable error, and Retry recovers with one request`, async ({ page }) => {
        await withSession(page, () => null);
        let failing = true; let reads = 0;
        await page.route(screen.api, route => { if (route.request().method() !== 'GET') return route.fallback(); reads++; return failing ? respond(route, outcome) : route.fulfill({ json: { data: screen.populated } }); });
        await page.goto(screen.path);
        await expect(page.getByRole('heading', { name: screen.error })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0);
        const before = reads; failing = false;
        await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
        expect(reads).toBe(before + 1);
        await expect(page.getByRole('heading', { name: screen.error })).toHaveCount(0);
      });
      test(`${label} from session refresh: bounded attempts, actionable error, Retry recovers`, async ({ page }) => {
        let failing = true;
        const calls = await withSession(page, () => failing ? outcome : null);
        await page.route(screen.api, route => route.request().method() === 'GET' ? route.fulfill({ json: { data: screen.populated } }) : route.fallback());
        await page.goto(screen.path);
        await expect(page.getByRole('heading', { name: screen.error })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0);
        await page.waitForTimeout(8_000);
        expect(calls.refresh).toBe(3); // bounded: no endless refresh loop
        failing = false;
        await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
        expect(calls.refresh).toBe(4);
      });
    }
    test('expired session (refresh 401) follows the guest flow, never an endless skeleton', async ({ page }) => {
      const calls = await withSession(page, () => ({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } } }));
      await page.goto(screen.path);
      await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByRole('heading', { name: screen.empty })).toBeVisible();
      expect(calls.refresh).toBe(1);
    });
    test('a hanging refresh stays truthfully loading without claiming success, failure or empty', async ({ page }) => {
      await withSession(page, () => 'hang');
      await page.goto(screen.path);
      await page.waitForTimeout(8_000);
      await expect(page.getByRole('status', { name: screen.skeleton })).toBeVisible();
      await expect(page.getByRole('heading', { name: screen.empty })).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
    test('background refetch keeps visible content and refresh/navigation never re-traps loading', async ({ page }) => {
      await withSession(page, () => null);
      let reads = 0;
      await page.route(screen.api, route => { if (route.request().method() !== 'GET') return route.fallback(); reads++; return route.fulfill({ json: { data: screen.populated } }); });
      await page.goto(screen.path);
      await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
      await page.reload();
      await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
      await page.getByRole('link', { name: 'Home', exact: true }).first().click();
      await page.goto(screen.path);
      await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('status', { name: screen.skeleton })).toHaveCount(0);
      expect(reads).toBeLessThanOrEqual(4);
    });
  });
}

test('concurrent Cart and Wishlist bootstrap share one bounded session restore; Home → Cart → Wishlist → Cart', async ({ page }) => {
  let failing = true;
  const calls = await withSession(page, () => failing ? { status: 503 } : null);
  await page.route('**/api/wishlist', route => route.request().method() === 'GET' ? route.fulfill({ json: { data: savedWishlist } }) : route.fallback());
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Unable to load your cart' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: /Wishlist/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Unable to load your wishlist' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading wishlist' })).toHaveCount(0);
  expect(calls.refresh).toBe(3);
  failing = false;
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(wishlistProduct.name, { exact: true }).first()).toBeVisible();
  await page.goto('/'); await page.getByRole('link', { name: /^Cart/ }).first().click();
  await expect(page.getByText(cart.items[0]!.product!.name, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Wishlist/ }).first().click();
  await expect(page.getByText(wishlistProduct.name, { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: /^Cart/ }).first().click();
  await expect(page.getByText(cart.items[0]!.product!.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading cart' })).toHaveCount(0);
});

for (const width of [390, 768, 1440, 1920]) {
  test(`visual states at ${width}px: skeleton, populated, empty, error`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let mode: 'hold' | 'populated' | 'empty' | 'error' = 'hold'; let release = () => {}; let held = Promise.resolve();
    await withSession(page, () => null);
    for (const screen of Object.values(pages)) await page.route(screen.api, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (mode === 'hold') await held;
      if (mode === 'error') return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } } });
      return route.fulfill({ json: { data: mode === 'empty' ? screen.emptyData : screen.populated } });
    });
    for (const [name, screen] of Object.entries(pages)) {
      mode = 'hold'; held = new Promise<void>(resolve => { release = resolve; });
      await page.goto(screen.path);
      await expect(page.getByRole('status', { name: screen.skeleton })).toBeVisible();
      await page.screenshot({ path: `test-results/checkout/loading-${name}-skeleton-${width}.png`, fullPage: true });
      mode = 'populated'; release();
      await expect(page.getByText(screen.content, { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `test-results/checkout/loading-${name}-populated-${width}.png`, fullPage: true });
      mode = 'empty'; await page.reload();
      await expect(page.getByRole('heading', { name: screen.empty })).toBeVisible();
      await page.screenshot({ path: `test-results/checkout/loading-${name}-empty-${width}.png`, fullPage: true });
      mode = 'error'; await page.reload();
      await expect(page.getByRole('heading', { name: screen.error })).toBeVisible({ timeout: 15_000 });
      const retry = page.getByRole('alert').getByRole('button', { name: 'Retry' });
      await retry.focus(); await expect(retry).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `test-results/checkout/loading-${name}-error-${width}.png`, fullPage: true });
    }
  });
}
