import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { cart } from '../../src/features/checkout/fixtures';

// Header Cart/Wishlist badge hydration. Real Chromium + production build; every /api/** request intercepted.
const SHOTS = 'test-results/header-badges/shots'; mkdirSync(SHOTS, { recursive: true });
const userA = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.invalid', firstName: 'Alex', lastName: 'A', role: 'CUSTOMER' };
const userB = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.invalid', firstName: 'Blake', lastName: 'B', role: 'CUSTOMER' };
const emptyCart = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
const wishlist = { items: [1, 2].map(n => ({ productId: `0000000${n}-0000-4000-8000-000000000000`, availability: 'AVAILABLE',
  product: { id: `0000000${n}-0000-4000-8000-000000000000`, name: `W${n}`, slug: `w${n}`, price: '1.00', currency: 'USD', availability: 'AVAILABLE',
    category: { id: 'c', name: 'C', slug: 'c' }, brand: null, primaryImage: null, secondaryImage: null } })), totalItems: 2 };

async function world(page: Page, opts: { me?: typeof userA; cached?: typeof userA; cartData?: unknown; pending?: boolean }) {
  const me = opts.me ?? userA;
  // Record every accessible name the Cart link ever had, from the first paint.
  await page.addInitScript(cached => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cached));
    const labels: string[] = []; Reflect.set(window, '__cartLabels', labels);
    new MutationObserver(() => {
      const label = document.querySelector('a[href="/cart"]')?.getAttribute('aria-label');
      if (label && labels.at(-1) !== label) labels.push(label);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  }, opts.cached ?? me);
  let gate: (() => void) | null = null; let held: Promise<void> | null = null;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (path.startsWith('/api/auth/')) return path === '/api/auth/me' ? send({ user: me }) : send({ accessToken: 'intercepted-ui-test-token', user: me });
    if (path === '/api/cart') { if (held) await held; return send({ data: opts.cartData ?? cart }); }
    if (path === '/api/wishlist') return send({ data: wishlist });
    if (path === '/api/checkout/payment-attempts') return send({ data: opts.pending ? [{ attemptId: 'aaaaaaaa-0000-4000-8000-00000000000a', scope: 'CART_CHECKOUT',
      state: 'PROCESSING', classification: 'PROCESSING', total: '49.00', currency: 'USD', pending: true, unread: false, orderReference: null,
      submittedAt: '2026-10-15T08:00:00Z', items: [{ name: 'Pending Mouse', quantity: 5 }] }] : [] });
    return send({ data: [], meta: { page: 1, pageSize: 12, total: 0, totalPages: 0 } });
  });
  return { hold() { held = new Promise(r => { gate = r; }); }, release() { held = null; gate?.(); } };
}
const cartLink = (page: Page) => page.locator('a[href="/cart"]').first();
const labels = (page: Page) => page.evaluate(() => Reflect.get(window, '__cartLabels') as string[]);

for (const width of [390, 1366]) test.describe(`header badges at ${width}px`, () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: width < 768 ? 844 : 768 }); });

  test('fresh load with an empty Cart', async ({ page }) => {
    await world(page, { cartData: emptyCart }); await page.goto('/');
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 0 items');
    await expect(cartLink(page).locator('span')).toHaveCount(0);
    expect(await labels(page)).not.toContainEqual(expect.stringMatching(/Cart, [1-9]/));
    await page.screenshot({ path: `${SHOTS}/${width}-empty.png` });
  });

  test('refresh + delayed Cart response: number-free, never 0, then the correct count; wishlist resolves', async ({ page }) => {
    const api = await world(page, {}); await page.goto('/');
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 2 items');
    api.hold(); await page.reload();
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart');
    await expect(cartLink(page).locator('span')).toHaveCount(0); await page.screenshot({ path: `${SHOTS}/${width}-delayed.png` });
    api.release();
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 2 items'); await expect(cartLink(page)).toContainText('2');
    await expect(page.locator('a[href="/wishlist"]').first()).toHaveAttribute('aria-label', 'Wishlist (2)');
    expect(await labels(page)).not.toContain('Cart, 0 items');
    await page.screenshot({ path: `${SHOTS}/${width}-resolved.png` });
  });

  test('background refetch keeps the verified count', async ({ page }) => {
    const api = await world(page, {}); await page.goto('/');
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 2 items');
    // In-app navigation to Cart revalidates it in the background (CartRouteValidation); the read is held.
    api.hold(); const reads = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cart');
    await cartLink(page).click(); await reads;
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 2 items'); await expect(cartLink(page)).toContainText('2');
    api.release(); await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 2 items');
    expect(await labels(page)).toEqual(['Cart', 'Cart, 2 items']);
  });

  test('customer switch never paints the previous customer\'s count', async ({ page }) => {
    await page.addInitScript(id => sessionStorage.setItem(`electrohub.cart.auth-count.v1:${id}`, '7'), userA.id);
    await world(page, { me: userB, cached: userA, cartData: { ...cart, totalQuantity: 1, items: cart.items.map(i => ({ ...i, quantity: 1 })) } });
    await page.goto('/');
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 1 item');
    expect((await labels(page)).join('|')).not.toMatch(/Cart, 7|Cart, 0/);
  });

  test('pending purchase A does not inflate active Cart B', async ({ page }) => {
    await world(page, { pending: true, cartData: { ...cart, totalQuantity: 1, items: cart.items.map(i => ({ ...i, quantity: 1 })) } });
    await page.goto('/cart'); await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
    await expect(cartLink(page)).toHaveAttribute('aria-label', 'Cart, 1 item');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/${width}-pending-A-cart-B.png` });
  });
});
