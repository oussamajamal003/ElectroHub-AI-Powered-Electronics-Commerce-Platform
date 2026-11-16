import { expect, test, type Page } from '@playwright/test';
import { harness } from './stripe.harness';

type Row = { attemptId: string; scope: string; state: string; classification: string; total: string; currency: string; pending: boolean; unread: boolean;
  orderReference: string | null; retryAllowed?: boolean; items: { name: string; quantity: number }[] };
const ids = { a: '79972f29-3ac6-4093-aee8-5d148acc95a4', b: '0b6d4f4e-5d62-4c53-9d6c-1f5f1d7f0c11', c: '5e0c7f10-1111-4222-8333-444455556666' };
const row = (attemptId: string, name: string, state: string, classification: string, extra: Partial<Row> = {}): Row => ({ attemptId, scope: 'CART_CHECKOUT', state, classification,
  total: '329.00', currency: 'USD', pending: true, unread: false, orderReference: null, retryAllowed: false, items: [{ name, quantity: 1 }], ...extra });
// A submitted purchase still at card entry is projected as Processing (Task 03.6: "Checkout saved" removed).
const awaiting = (id = ids.a) => row(id, 'Apple Watch Series 9', 'AWAITING_INPUT', 'PROCESSING');
const processing = (id = ids.b) => row(id, 'Wireless Mouse', 'PROCESSING', 'PROCESSING');
const unknown = (id = ids.c) => row(id, 'USB-C Cable', 'INCIDENT', 'UNKNOWN');
const failed = (r: Row): Row => ({ ...r, state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true, retryAllowed: true });
const paid = (r: Row): Row => ({ ...r, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: `ORD-${r.attemptId.slice(0, 4).toUpperCase()}` });
const SUCCESS = 'Payment successful! Your order has been confirmed.';
const FAILURE = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';

async function serve(page: Page, initial: Row[]) {
  const api = await harness(page); let rows = initial; let hold: Promise<void> | null = null;
  await page.route('**/api/checkout/payment-attempts**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/checkout/payment-attempts') { if (hold) await hold; return route.fulfill({ json: { data: rows } }); }
    if (method === 'POST' && url.pathname.endsWith('/read')) return route.fulfill({ json: { data: {} } });
    return route.fallback();
  });
  return { api, set: (next: Row[]) => { rows = next; },
    holdNext: () => { let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); return () => { hold = null; release(); }; },
    refetch: () => page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))) };
}
const card = (page: Page, id: string) => page.locator(`[data-purchase="${id}"]`);
const toasts = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test.describe(`pending purchase cards at ${viewport.width}px`, () => {
    test.use({ viewport });
    test('unresolved purchases show Processing / Awaiting confirmation with progress and no payment action; Cart B is unaffected', async ({ page }) => {
      const feed = await serve(page, [awaiting(), processing(), unknown()]);
      await page.goto('/cart');
      await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
      for (const [id, label] of [[ids.a, 'Processing'], [ids.b, 'Processing'], [ids.c, 'Awaiting confirmation']] as const) {
        const c = card(page, id); await expect(c).toBeVisible();
        await expect(c.getByText(label, { exact: true })).toBeVisible();
        await expect(c.locator('[class*="purchaseProgress"]')).toHaveCount(1);
        await expect(c.locator('a, button')).toHaveCount(0);
      }
      await expect(page.getByText('Action required')).toHaveCount(0);
      await expect(page.getByText('Continue payment')).toHaveCount(0);
      await expect(page.getByText('Try Again')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Failed payments' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
      await expect(page.getByText('Apple iPhone 15 Pro').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/checkout/pending-cards-${viewport.width}.png`, fullPage: true });
      // No payment/setup/submit request is ever made from these cards.
      expect(feed.api.requests.filter(value => value.method === 'POST' && value.path.startsWith('/api/checkout'))).toHaveLength(0);
      await expect(toasts(page)).toHaveCount(0);
    });

    test('a purchase unresolved for hours shows a clear escalation note with a support reference and still no payment action', async ({ page }) => {
      await serve(page, [{ ...awaiting(), submittedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() } as Row, processing()]);
      await page.goto('/cart');
      const stale = card(page, ids.a);
      await expect(stale).toContainText('taking longer than expected');
      await expect(stale).toContainText('reference 79972F29');
      await expect(stale.locator('a, button')).toHaveCount(0);
      await expect(card(page, ids.b)).not.toContainText('taking longer than expected');
      await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/checkout/pending-stale-${viewport.width}.png`, fullPage: true });
    });

    test('pending → DECLINED: a delayed read keeps the card, then it moves to Failed payments with Try Again and one toast', async ({ page }) => {
      const feed = await serve(page, [awaiting(), processing()]);
      await page.goto('/cart'); await expect(card(page, ids.a)).toBeVisible();
      feed.set([failed(awaiting()), processing()]);
      const release = feed.holdNext(); await feed.refetch();
      for (const wait of [300, 600, 900]) {
        await page.waitForTimeout(wait);
        await expect(card(page, ids.a).getByText('Processing', { exact: true })).toBeVisible(); await expect(toasts(page)).toHaveCount(0);
      }
      release();
      await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(1);
      const failedCard = page.locator('section[aria-labelledby="saved-purchases-heading"]').locator(`[data-purchase="${ids.a}"]`);
      await expect(failedCard.getByRole('link', { name: /^Try Again/ })).toHaveAttribute('href', '/checkout?step=payment');
      await expect(page.locator('section[aria-labelledby="pending-purchases-heading"]').locator(`[data-purchase="${ids.a}"]`)).toHaveCount(0);
      await expect(card(page, ids.b).getByText('Processing', { exact: true })).toBeVisible(); // untouched sibling
      await page.screenshot({ path: `test-results/checkout/pending-to-failed-${viewport.width}.png`, fullPage: true });
      await feed.refetch(); await page.waitForTimeout(800); await expect(toasts(page)).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
      await page.reload(); await page.waitForTimeout(1500);
      await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(0); // one-time: never repeats after refresh
      await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
    });

    test('pending → PAID: the card leaves Pending, one success toast links to the order, nothing lands in Failed', async ({ page }) => {
      const feed = await serve(page, [awaiting(), unknown()]);
      await page.goto('/cart'); await expect(card(page, ids.a)).toBeVisible();
      feed.set([paid(awaiting()), unknown()]); await feed.refetch();
      await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 8000 });
      await expect(page.getByRole('link', { name: 'View Order' })).toHaveAttribute('href', '/checkout/confirmation/ORD-7997');
      await expect(card(page, ids.a)).toHaveCount(0, { timeout: 5000 });
      await expect(page.getByRole('heading', { name: 'Failed payments' })).toHaveCount(0);
      await expect(card(page, ids.c).getByText('Awaiting confirmation', { exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/checkout/pending-to-paid-${viewport.width}.png`, fullPage: true });
      await feed.refetch(); await page.waitForTimeout(800); await expect(toasts(page)).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
      await expect(page.getByText(SUCCESS, { exact: true })).toBeHidden({ timeout: 9000 });
      await feed.refetch(); await page.waitForTimeout(800); await expect(toasts(page)).toHaveCount(0);
    });

    test('refreshing while pending keeps the Processing card and shows no toast', async ({ page }) => {
      await serve(page, [awaiting(), unknown()]);
      await page.goto('/cart'); await expect(card(page, ids.a).getByText('Processing', { exact: true })).toBeVisible();
      await page.reload();
      await expect(card(page, ids.a).getByText('Processing', { exact: true })).toBeVisible();
      await expect(card(page, ids.c).getByText('Awaiting confirmation', { exact: true })).toBeVisible();
      await page.waitForTimeout(1200); await expect(toasts(page)).toHaveCount(0);
    });

    test('a late result toasts on another customer page and leaves Checkout B untouched', async ({ page }) => {
      const feed = await serve(page, [awaiting()]);
      await page.goto('/checkout'); await page.locator('#shipping-recipient').fill('Checkout B recipient');
      feed.set([paid(awaiting())]); await feed.refetch();
      await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 8000 });
      await expect(page.locator('#shipping-recipient')).toHaveValue('Checkout B recipient'); await expect(page).toHaveURL(/\/checkout/);
    });
  });
}
