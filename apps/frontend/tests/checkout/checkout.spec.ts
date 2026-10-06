import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cart, confirmation, quote, shipping } from '../../src/features/checkout/fixtures';

test.beforeEach(async ({ page }) => { page.on('pageerror', error => console.error('Checkout runtime:', error.message)); page.on('console', message => { if (message.type() === 'error') console.error('Checkout console:', message.text()); }); });

async function harness(page: Page, options: { guest?: boolean; empty?: boolean; conflict?: string; unknown?: boolean; committedUnknown?: boolean } = {}) {
  const requests: { method: string; path: string; body?: unknown; key?: string }[] = [];
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'checkout-demo@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
  if (!options.guest) await page.addInitScript(user => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)); }, user);
  let current = options.empty ? { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false } : structuredClone(cart);
  let committed = false; let failOnce = options.unknown || options.committedUnknown; let release: (() => void) | undefined;
  let hold = false;
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
    if (!path.startsWith('/api/')) return route.continue();
    requests.push({ method, path, ...(method === 'POST' ? { body: request.postDataJSON(), key: request.headers()['idempotency-key'] } : {}) });
    const send = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path.startsWith('/api/auth/')) return options.guest ? send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } }, 401) : path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'intercepted-ui-test-token', user });
    if (path === '/api/cart') return send({ data: current });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === '/api/checkout') return send({ data: quote });
    if (path === '/api/orders' && method === 'POST') {
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (options.conflict) return send({ error: { code: options.conflict, message: 'Your cart changed. Review current prices and availability.' } }, 409);
      if (failOnce) { failOnce = false;
        if (options.committedUnknown) { committed = true; current = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false }; }
        return route.abort('failed'); }
      committed = true; current = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
      return send({ data: { confirmation, cart: current, replayed: false } }, 201);
    }
    if (path.startsWith('/api/orders/attempts/')) return committed ? send({ data: confirmation }) : send({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } }, 404);
    if (path.startsWith('/api/orders/')) return send({ data: confirmation });
    return send({ data: [], meta: { total: 0, page: 1, totalPages: 0 } });
  });
  return { requests, hold: () => { hold = true; }, release: () => { hold = false; release?.(); } };
}
async function capture(page: Page, path: string) {
  // Full-document capture must not place the fixed app header at a scrolled viewport offset.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path, fullPage: true });
}
async function fillShipping(page: Page) {
  for (const [field, value] of Object.entries(shipping)) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
}
async function review(page: Page) {
  await fillShipping(page); await page.getByRole('radio', { name: /Express Delivery/ }).check();
  await page.getByRole('button', { name: 'Continue to Payment' }).click(); await page.getByRole('button', { name: 'Review Order' }).click();
}

test('A, B: verified customer guard, guest return flow and empty Cart (intercepted UI)', async ({ page }) => {
  await harness(page, { guest: true });
  const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/refresh');
  await page.goto('/checkout?step=review'); await restored;
  await expect(page).toHaveURL(/\/cart$/); await expect(page.getByText('Your cart is empty')).toBeVisible();
});
test('B: resolved authenticated empty Cart cannot submit (intercepted UI)', async ({ page }) => {
  const api = await harness(page, { empty: true }); await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible(); expect(api.requests.filter(request => request.path === '/api/orders')).toEqual([]);
});
test('C–J: Shipping focus, guards, draft/history preservation and all delivery totals (intercepted UI)', async ({ page }) => {
  const api = await harness(page); await page.goto('/checkout?step=review');
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Delivery' }).click(); await expect(page.locator('#shipping-recipient')).toBeFocused();
  await capture(page, 'screenshots/checkout-visual/shipping-validation.png');
  await fillShipping(page); await expect(page.getByText('Free', { exact: true }).first()).toBeVisible();
  await page.getByRole('radio', { name: /Express Delivery/ }).check(); await expect(page.getByText('$2,209.97')).toBeVisible();
  await page.getByRole('radio', { name: /Overnight Delivery/ }).check(); await expect(page.getByText('$2,219.97')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await expect(page.locator('#shipping-city')).toHaveValue(shipping.city);
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Delivery Method' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Payment' }).click(); await expect(page.getByText(/No card details are collected/)).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0); await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByText(/123 Demo Street/)).toBeVisible(); await page.getByRole('button', { name: 'Edit Shipping Address' }).click();
  await expect(page.locator('#shipping-recipient')).toHaveValue(shipping.recipient); await page.reload(); await expect(page.locator('#shipping-recipient')).toHaveValue(shipping.recipient);
  expect(api.requests.filter(request => request.path === '/api/checkout')).toHaveLength(2); // one per document, never per step
});
test('K–M, T, V, AA, AB: Processing, single submission, cache/header clearing and persisted Confirmation (intercepted UI)', async ({ page }) => {
  const api = await harness(page); api.hold(); await page.goto('/checkout'); await review(page);
  const button = page.getByRole('button', { name: /Place Order/ }); await button.click();
  await expect(page.getByText('Processing your order…')).toBeVisible(); await expect(page.getByRole('status')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Place Order/ })).toHaveCount(0);
  expect(api.requests.filter(request => request.path === '/api/orders')).toHaveLength(1); api.release();
  await expect(page.getByText('Order Confirmed!')).toBeVisible(); await expect(page.getByText('Order Total')).toBeVisible();
  await expect(page.getByText(/No payment has been processed/)).toBeVisible(); await page.reload(); await expect(page.getByText(confirmation.orderReference)).toBeVisible();
  expect(api.requests.filter(request => request.path.includes('/inventory'))).toEqual([]);
  const post = api.requests.find(request => request.path === '/api/orders'); expect(Object.keys(post?.body as object).sort()).toEqual(['deliveryMethod', 'expectedRevision', 'paymentMethod', 'shipping']);
  await expect(page.getByText('Total Paid')).toHaveCount(0); await expect(page.getByText('View Order Details')).toHaveCount(0);
});
test('U: uncertain submission survives reload and retries the same immutable attempt (intercepted UI)', async ({ page }) => {
  const api = await harness(page, { unknown: true }); await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByRole('button', { name: 'Retry same checkout attempt' })).toBeVisible();
  const first = api.requests.find(request => request.path === '/api/orders'); await page.reload();
  await expect(page.getByRole('button', { name: 'Retry same checkout attempt' })).toBeVisible(); await expect(page.getByText('Your cart is empty')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry same checkout attempt' }).click(); await expect(page.getByText('Order Confirmed!')).toBeVisible();
  const attempts = api.requests.filter(request => request.path === '/api/orders'); expect(attempts).toHaveLength(2); expect(attempts[1]?.key).toBe(first?.key); expect(attempts[1]?.body).toEqual(first?.body);
});
test('U, V: recovery finds a committed order after a lost response before rendering empty Cart (intercepted UI)', async ({ page }) => {
  const api = await harness(page, { committedUnknown: true }); await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByText('Order Confirmed!')).toBeVisible();
  expect(api.requests.filter(request => request.path === '/api/orders')).toHaveLength(1);
  expect(api.requests.some(request => request.path.startsWith('/api/orders/attempts/'))).toBe(true);
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
});
test('slow network: real pending loader, no duplicate purchase and persisted confirmation (intercepted UI)', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Network.enable'); await session.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
  const api = await harness(page); api.hold();
  const cartReady = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cart');
  await page.goto('/checkout'); await cartReady;
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible(); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByText('Processing your order…')).toBeVisible();
  await expect(page.getByText('Order Confirmed!')).toHaveCount(0); await capture(page, 'screenshots/checkout-visual/slow-processing.png');
  api.release(); await expect(page.getByText('Order Confirmed!')).toBeVisible();
  expect(api.requests.filter(request => request.path === '/api/orders')).toHaveLength(1);
});
test('slow network: persisted Confirmation loads independently of Cart (intercepted UI)', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Network.enable'); await session.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
  const api = await harness(page, { empty: true });
  const confirmationReady = page.waitForResponse(response => new URL(response.url()).pathname === `/api/orders/${confirmation.orderReference}/confirmation`);
  await page.goto(`/checkout/confirmation/${confirmation.orderReference}`); await confirmationReady;
  await expect(page.getByText(confirmation.orderReference)).toBeVisible();
  await expect(page.getByText('Order Confirmed!')).toBeVisible();
  expect(api.requests.filter(request => request.path === '/api/orders')).toHaveLength(0);
});
test('slow background totals revalidation preserves Review and blocks a changed economic revision (intercepted UI)', async ({ page, context }) => {
  await page.clock.install(); await harness(page); await page.goto('/checkout'); await review(page);
  await expect(page.getByRole('button', { name: /Place Order/ })).toBeEnabled();
  const session = await context.newCDPSession(page);
  await session.send('Network.enable'); await session.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
  let release!: () => void; let started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/checkout', async route => { started(); await pending; await route.fulfill({ json: { data: { ...quote, cartRevision: 'b'.repeat(64) } } }); });
  await page.clock.fastForward(31000); await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); }); await requested;
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible(); await expect(page.getByText(/123 Demo Street/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Place Order/ })).toBeDisabled(); release();
  await expect(page.getByRole('alert').filter({ hasText: /Your cart needs review/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Place Order/ })).toBeDisabled();
});
for (const conflict of ['CART_STOCK_CONFLICT', 'PRODUCT_UNAVAILABLE', 'CHECKOUT_CHANGED']) test(`P–R: ${conflict} preserves draft and Cart (intercepted UI)`, async ({ page, context }) => {
  await harness(page, { conflict }); await page.goto('/checkout'); await review(page);
  const session = await context.newCDPSession(page); await session.send('Network.enable'); await session.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Your cart changed/ })).toBeVisible(); await expect(page.getByText('Order Confirmed!')).toHaveCount(0);
  await capture(page, `screenshots/checkout-visual/conflict-${conflict}.png`);
  await page.getByRole('button', { name: 'Edit Shipping Address' }).click(); await expect(page.locator('#shipping-recipient')).toHaveValue(shipping.recipient);
});
for (const width of [390, 768, 1440, 1920]) test(`X–Z: complete checkout visual/keyboard/reduced-motion at ${width} (intercepted UI)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' }); const api = await harness(page); api.hold();
  const cartReady = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cart');
  await page.goto('/checkout'); await cartReady; await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  await capture(page, `screenshots/checkout-visual/shipping-${width}.png`);
  await fillShipping(page); await page.getByRole('radio', { name: /Express Delivery/ }).focus(); await page.keyboard.press('Space');
  await capture(page, `screenshots/checkout-visual/delivery-${width}.png`);
  await page.getByRole('button', { name: 'Continue to Payment' }).click(); await expect(page.getByRole('heading', { name: 'Payment Method', exact: true })).toBeVisible(); await capture(page, `screenshots/checkout-visual/payment-${width}.png`);
  await page.getByRole('button', { name: 'Review Order' }).click(); await expect(page.getByRole('heading', { name: 'Review Your Order', exact: true })).toBeVisible(); await capture(page, `screenshots/checkout-visual/review-${width}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.addScriptTag({ content: readFileSync('../../node_modules/axe-core/axe.min.js', 'utf8') });
  const violations = await page.evaluate(async () => (await (window as Window & { axe: { run: (options: object) => Promise<{ violations: { id: string }[] }> } }).axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(value => value.id));
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByText('Processing your order…')).toBeVisible(); await capture(page, `screenshots/checkout-visual/processing-${width}.png`);
  api.release(); await expect(page.getByText('Order Confirmed!')).toBeVisible(); await capture(page, `screenshots/checkout-visual/confirmation-${width}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
