import { expect, test, type Page } from '@playwright/test';
import { manyItemsDetails, manyItemsSummary, orderDetails, orderSummary, ordersPage } from '../../src/features/orders/fixtures';
import type { OrderDetails, OrderSummary } from '../../src/features/orders/types';

// Task 03.7 browser journeys. MOCKED READS: every /api call is intercepted with deterministic synthetic fixtures.
// These prove UI behavior/layout, not PostgreSQL ownership (see backend orders.management.live.test.ts for the DEV gate).
const SHOTS = 'test-results/orders';
const WIDTHS = [390, 768, 1440, 1920] as const;
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'orders-demo@example.invalid', firstName: 'Jordan', lastName: 'Lee', role: 'CUSTOMER' };

type Options = { orders?: OrderSummary[]; total?: number; details?: Record<string, OrderDetails | number>; listStatus?: number; delay?: (page: number) => number; guest?: boolean };
async function harness(page: Page, options: Options = {}) {
  const requests: { method: string; path: string }[] = [];
  const orders = options.orders ?? [orderSummary(0)];
  if (!options.guest) await page.addInitScript(value => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)); }, user);
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    requests.push({ method: request.method(), path });
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path.startsWith('/api/auth/')) return options.guest ? send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } }, 401)
      : path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'intercepted-orders-token', user });
    if (path === '/api/cart') return send({ data: { revision: 'a'.repeat(64), items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === '/api/checkout/payment-attempts') return send({ data: [] });
    if (path === '/api/orders') {
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      const wait = options.delay?.(pageNumber) ?? 0; if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      if (options.listStatus) return send({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, options.listStatus);
      const total = options.total ?? orders.length;
      return send(ordersPage(orders.slice((pageNumber - 1) * 10, pageNumber * 10), pageNumber, total));
    }
    const confirmation = /^\/api\/orders\/([^/]+)\/confirmation$/.exec(path);
    if (confirmation) return send({ data: { ...orderDetails(), orderReference: decodeURIComponent(confirmation[1]!) } });
    const detail = /^\/api\/orders\/([^/]+)$/.exec(path);
    if (detail) {
      const found = options.details?.[decodeURIComponent(detail[1]!)];
      if (typeof found === 'number') return send({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, found);
      return found ? send({ data: found }) : send({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } }, 404);
    }
    return send({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  });
  return requests;
}
async function settle(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.complete ? null : new Promise(done => { image.onload = image.onerror = done; }))); });
}
async function shot(page: Page, name: string, width: number) {
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}
const many = Array.from({ length: 25 }, (_, index) => index % 4 === 1 ? manyItemsSummary(25 - index) : orderSummary(25 - index, {
  status: (['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)[index % 5],
  paymentState: index % 5 === 4 ? 'REFUNDED' : 'PAID' }));

test.describe('E01/E02 navigation, direct entry and history context', () => {
  test('Header Orders → history → details → Back to Orders, refresh and Back/Forward', async ({ page }) => {
    const target = many[12]!; const details = { ...orderDetails(), orderReference: target.orderReference };
    await harness(page, { orders: many, details: { [target.orderReference]: details } });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Orders', exact: true }).first().click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My Orders' })).toBeVisible();
    await expect(page.getByText('25 orders')).toBeVisible();
    await page.getByRole('button', { name: 'Go to page 2' }).click();
    await expect(page).toHaveURL(/\/orders\?page=2$/);
    await page.getByRole('link', { name: `${target.orderReference}, view order details` }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${target.orderReference}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Order ${target.orderReference}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: `Order ${target.orderReference}` })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/\/orders\?page=2$/);
    await expect(page.getByRole('link', { name: `${target.orderReference}, view order details` })).toBeVisible();
    await page.goForward(); await expect(page.getByRole('heading', { level: 1, name: `Order ${target.orderReference}` })).toBeVisible();
    await page.goBack(); await page.getByRole('link', { name: `${target.orderReference}, view order details` }).click();
    await page.getByRole('link', { name: 'Back to Orders' }).click();
    await expect(page).toHaveURL(/\/orders\?page=2$/);
  });
  test('Account and Footer entries reach the canonical /orders route', async ({ page }) => {
    await harness(page);
    await page.goto('/account');
    await page.getByRole('main').getByRole('link', { name: /Orders/ }).first().click();
    await expect(page).toHaveURL(/\/orders$/);
    await page.getByRole('contentinfo').getByRole('link', { name: 'Orders', exact: true }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('link', { name: 'Back to Account' })).toHaveAttribute('href', '/account');
  });
  test('keyboard: Tab reaches the card link with visible focus and Enter opens details', async ({ page }) => {
    const order = orderSummary(0);
    await harness(page, { orders: [order], details: { [order.orderReference]: orderDetails() } });
    await page.goto('/orders');
    const link = page.getByRole('link', { name: `${order.orderReference}, view order details` });
    await expect(link).toBeVisible();
    await link.focus();
    const outline = await link.evaluate(element => getComputedStyle(element, '::after').outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: `Order ${order.orderReference}` })).toBeFocused();
  });
});

test.describe('E03/E08 pagination, races, loading and errors', () => {
  test('rapid page changes never let an older response replace the newer page', async ({ page }) => {
    await harness(page, { orders: many, delay: pageNumber => pageNumber === 2 ? 1500 : 100 });
    await page.goto('/orders'); await expect(page.getByText('25 orders')).toBeVisible();
    await page.getByRole('button', { name: 'Go to page 2' }).click();
    await page.getByRole('button', { name: 'Go to page 3' }).click();
    await expect(page).toHaveURL(/page=3$/);
    await expect(page.getByRole('link', { name: `${many[20]!.orderReference}, view order details` })).toBeVisible();
    await page.waitForTimeout(1700);
    await expect(page.getByRole('link', { name: `${many[20]!.orderReference}, view order details` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${many[10]!.orderReference}, view order details` })).toHaveCount(0);
  });
  test('slow first load shows structure, never an empty state or a zero count', async ({ page }) => {
    await harness(page, { orders: [], delay: () => 2500 });
    await page.goto('/orders');
    await expect(page.getByRole('status', { name: 'Loading your orders' })).toBeVisible();
    await expect(page.getByText('You have no orders yet.')).toHaveCount(0);
    await expect(page.getByText('0 orders')).toHaveCount(0);
    await expect(page.getByText('You have no orders yet.')).toBeVisible({ timeout: 10000 });
  });
  test('failed history read offers Retry, not the empty state', async ({ page }) => {
    await harness(page, { listStatus: 500 });
    await page.goto('/orders');
    await expect(page.getByText('Your orders could not be loaded.')).toBeVisible();
    await expect(page.getByText('You have no orders yet.')).toHaveCount(0);
  });
});

test.describe('E05/E06/E07 details states', () => {
  test('unknown or other-customer reference renders the safe unavailable state', async ({ page }) => {
    await harness(page, { details: {} });
    await page.goto(`/orders/${orderSummary(77).orderReference}`);
    await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });
  test('guest is asked to sign in and makes no private Order request', async ({ page }) => {
    const requests = await harness(page, { guest: true });
    await page.goto(`/orders/${orderSummary(1).orderReference}`);
    await expect(page.getByRole('heading', { name: 'Sign In Required' })).toBeVisible();
    expect(requests.filter(request => request.path.startsWith('/api/orders'))).toHaveLength(0);
  });
});

test.describe('E09 Confirmation actions', () => {
  test('View Order Details is outside the card, aligned to it, above Continue Shopping, and only navigates', async ({ page }) => {
    const reference = orderDetails().orderReference;
    const requests = await harness(page, { details: { [reference]: orderDetails() } });
    await page.goto(`/checkout/confirmation/${reference}`);
    const card = page.getByRole('region', { name: 'Order confirmation' });
    const primary = page.getByRole('link', { name: 'View Order Details', exact: true });
    const secondary = page.getByRole('link', { name: 'Continue Shopping', exact: true });
    await expect(primary).toBeVisible();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 911 }); await settle(page);
      const [c, p, s] = await Promise.all([card.boundingBox(), primary.boundingBox(), secondary.boundingBox()]);
      expect(Math.abs(p!.x - c!.x)).toBeLessThanOrEqual(1); expect(Math.abs(p!.x + p!.width - (c!.x + c!.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(s!.width - p!.width)).toBeLessThanOrEqual(1);
      expect(p!.y).toBeGreaterThan(c!.y + c!.height); expect(s!.y).toBeGreaterThan(p!.y + p!.height);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/confirmation-actions-${width}.png`, fullPage: true });
    }
    await expect(card.getByRole('link', { name: 'View Order Details' })).toHaveCount(0);
    await primary.click();
    await expect(page).toHaveURL(new RegExp(`/orders/${reference}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Order ${reference}` })).toBeVisible();
    expect(requests.filter(request => request.method !== 'GET' && !request.path.startsWith('/api/auth/'))).toEqual([]);
  });
});

test.describe('E04/E10 responsive visual evidence (mocked reads)', () => {
  for (const width of WIDTHS) {
    test(`history, empty, details and states at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 852 : 911 });
      const normal = orderDetails(); const long = { ...manyItemsDetails(), orderReference: manyItemsSummary(9).orderReference };
      const refunded = { ...orderDetails({ status: 'CANCELLED', paymentState: 'REFUNDED', card: null, payment: { paidAt: null, refundedAt: '2026-09-06T00:00:00.000Z' } }), orderReference: orderSummary(5).orderReference };
      await harness(page, { orders: many.slice(0, 3), total: 3, details: { [normal.orderReference]: normal, [long.orderReference]: long, [refunded.orderReference]: refunded, [orderSummary(6).orderReference]: 503 } });

      await page.goto('/orders'); await expect(page.getByText('3 orders')).toBeVisible();
      await noHorizontalOverflow(page); await shot(page, 'history', width);

      await page.goto(`/orders/${normal.orderReference}`); await expect(page.getByRole('heading', { level: 1, name: /^Order ORD-/ })).toBeVisible();
      await noHorizontalOverflow(page); await shot(page, 'details', width);
      if (width >= 1024) {
        const items = await page.getByRole('region', { name: /^Items/ }).boundingBox(); const summary = await page.getByRole('region', { name: 'Order Summary' }).boundingBox();
        expect(Math.abs(items!.y - summary!.y)).toBeLessThanOrEqual(1); expect(items!.width).toBeGreaterThan(summary!.width * 1.6);
      }
      await page.goto(`/orders/${long.orderReference}`); await expect(page.getByRole('region', { name: 'Items (8)' })).toBeVisible();
      await noHorizontalOverflow(page); await shot(page, 'details-long', width);
      await page.goto(`/orders/${refunded.orderReference}`); await expect(page.getByText('Payment status: Refunded')).toHaveCount(1);
      await shot(page, 'details-cancelled-refunded', width);
      await page.goto(`/orders/${orderSummary(6).orderReference}`); await expect(page.getByText('This order could not be loaded.')).toBeVisible();
      await shot(page, 'details-error', width);
      await page.goto(`/orders/${orderSummary(88).orderReference}`); await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
      await shot(page, 'details-not-found', width);
    });
    test(`centered empty history at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 852 : 911 });
      await harness(page, { orders: [] });
      await page.goto('/orders');
      const panel = page.locator('main').getByText('You have no orders yet.').locator('..');
      await expect(panel).toBeVisible();
      const [box, heading, main, footer] = await Promise.all([panel.boundingBox(), page.getByRole('heading', { level: 1 }).boundingBox(),
        page.locator('main').first().boundingBox(), page.getByRole('contentinfo').boundingBox()]);
      const content = await page.locator('main').first().evaluate(element => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
        return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) }; });
      expect(Math.abs((box!.x + box!.width / 2) - (content.left + content.right) / 2)).toBeLessThanOrEqual(2);
      expect(box!.y).toBeGreaterThan(heading!.y + heading!.height); expect(box!.y + box!.height).toBeLessThan(footer!.y);
      expect(box!.width).toBeLessThanOrEqual(Math.min(512, main!.width) + 1);
      await noHorizontalOverflow(page); await shot(page, 'history-empty', width);
    });
  }
  test('loading states at 390 and 1440', async ({ page }) => {
    await harness(page, { orders: many, delay: () => 60000, details: {} });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 852 });
      await page.goto('/orders'); await expect(page.getByRole('status', { name: 'Loading your orders' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/history-loading-${width}.png`, fullPage: true });
    }
  });
});
