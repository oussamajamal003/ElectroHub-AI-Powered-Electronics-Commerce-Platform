import { test, expect, type Page, type Route } from '@playwright/test';
import { harness } from './stripe.harness';

// Intercepted QA only: no shared DEV, no session rows, no backend. The dismissal endpoint is simulated; the
// persistence guarantee comes from backend tests and a separately authorized migration, not from these results.
const viewports = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1366', width: 1366, height: 768 }];
const dismissUrl = /\/api\/checkout\/payment-attempts\/[^/]+\/dismiss$/;
const failedA = '55555555-5555-4555-8555-555555555555';
const failedC = '66666666-6666-4666-8666-666666666666';

function purchase(attemptId: string, name: string, overrides: Record<string, unknown> = {}) {
  return { attemptId, checkoutId: attemptId, scope: 'CART_CHECKOUT', state: 'DECLINED', classification: 'DECLINED', total: '49.00', currency: 'USD',
    pending: false, unread: false, orderReference: null, retryAllowed: true, submittedAt: '2026-10-15T09:00:00.000Z', updatedAt: '2026-10-15T09:01:00.000Z',
    items: [{ name, quantity: 1, imageUrl: null }], ...overrides };
}

async function listRoute(page: Page, rows: () => unknown[]) {
  await page.route('**/api/checkout/payment-attempts', (route: Route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { data: rows() } }) : route.fallback());
}

async function card(page: Page, attemptId: string) { return page.locator(`article[data-purchase="${attemptId}"]`); }

async function box(locator: ReturnType<Page['locator']>) { return locator.boundingBox(); }

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const viewport of viewports) {
  test.describe(`${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('icon sits top-right, clear of the product, badge and Try Again; no overflow', async ({ page }) => {
      await harness(page);
      await listRoute(page, () => [purchase(failedA, 'Apple iPhone 16 128GB — Pink')]);
      await page.goto('/cart');
      const c = await card(page, failedA);
      await expect(c.getByRole('button', { name: 'Remove failed payment for Apple iPhone 16 128GB — Pink' })).toBeVisible();
      const cardBox = await box(c); const trigger = await box(c.getByRole('button', { name: /Remove failed payment/ }));
      const name = await box(c.getByText('Apple iPhone 16 128GB — Pink', { exact: true })); const badge = await box(c.getByText('Payment failed', { exact: true }));
      const tryAgain = await box(c.getByRole('link', { name: /^Try Again/ }));
      if (!cardBox || !trigger || !name || !badge || !tryAgain) throw new Error('layout box missing');
      expect(trigger.x + trigger.width).toBeLessThanOrEqual(cardBox.x + cardBox.width - 4);
      expect(trigger.y).toBeGreaterThanOrEqual(cardBox.y);
      expect(trigger.y + trigger.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
      expect(overlaps(trigger, name)).toBe(false);
      expect(overlaps(trigger, badge)).toBe(false);
      expect(overlaps(trigger, tryAgain)).toBe(false);
      expect(badge.y).toBeGreaterThanOrEqual(trigger.y + trigger.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/dismissal/card-${viewport.name}.png`, fullPage: false });
    });

    test('dialog opens, Cancel closes it, sends no request and restores focus', async ({ page }) => {
      await harness(page); const requests: string[] = [];
      page.on('request', req => { if (dismissUrl.test(new URL(req.url()).pathname)) requests.push(req.method()); });
      await listRoute(page, () => [purchase(failedA, 'Apple iPhone 16 128GB — Pink')]);
      await page.goto('/cart');
      const trigger = (await card(page, failedA)).getByRole('button', { name: /Remove failed payment/ });
      await trigger.click();
      await expect(page.getByRole('heading', { name: 'Remove this failed payment?' })).toBeVisible();
      await expect(page.getByText('This purchase will be removed from your Failed payments list. Your payment history will be preserved.')).toBeVisible();
      await page.waitForTimeout(600); // let the entry animation finish before the visual capture
      await page.screenshot({ path: `test-results/dismissal/dialog-open-${viewport.name}.png` });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Remove this failed payment?' })).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(requests).toEqual([]);
      await page.screenshot({ path: `test-results/dismissal/dialog-${viewport.name}.png` });
    });

    test('keyboard: Enter opens the dialog, Escape closes it and returns focus to the trigger', async ({ page }) => {
      await harness(page);
      await listRoute(page, () => [purchase(failedA, 'Apple iPhone 16 128GB — Pink')]);
      await page.goto('/cart');
      const trigger = (await card(page, failedA)).getByRole('button', { name: /Remove failed payment/ });
      await trigger.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Remove this failed payment?' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Remove this failed payment?' })).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test('confirm sends exactly one owner-scoped dismissal and removes only the selected card', async ({ page }) => {
      await harness(page); const dismissed: string[] = []; let serverRows = [purchase(failedA, 'Apple iPhone 16 128GB — Pink'), purchase(failedC, 'Galaxy Tab S9')];
      await page.route(dismissUrl, async route => {
        const id = new URL(route.request().url()).pathname.split('/')[4]; dismissed.push(id);
        serverRows = serverRows.filter(row => row.attemptId !== id);
        await route.fulfill({ json: { data: { attemptId: id, dismissedAt: '2026-10-15T10:00:00.000Z' } } });
      });
      await listRoute(page, () => serverRows);
      await page.goto('/cart');
      await (await card(page, failedA)).getByRole('button', { name: /Remove failed payment/ }).click();
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(await card(page, failedA)).toHaveCount(0);
      await expect(await card(page, failedC)).toHaveCount(1);
      expect(dismissed).toEqual([failedA]);
      await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeFocused();
      await page.screenshot({ path: `test-results/dismissal/after-dismiss-${viewport.name}.png` });
    });

    test('server failure keeps the card and shows a recoverable error', async ({ page }) => {
      await harness(page);
      await page.route(dismissUrl, route => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal error' } } }));
      await listRoute(page, () => [purchase(failedA, 'Apple iPhone 16 128GB — Pink')]);
      await page.goto('/cart');
      await (await card(page, failedA)).getByRole('button', { name: /Remove failed payment/ }).click();
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(page.getByText(/could not be removed\. Your purchase is unchanged/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(await card(page, failedA)).toHaveCount(1);
    });

    test('a fresh server response with dismissedAt set keeps the purchase hidden', async ({ page }) => {
      await harness(page);
      // The server filters dismissed rows out of the customer list; a reload must not bring the card back.
      await listRoute(page, () => [purchase(failedC, 'Galaxy Tab S9')]);
      await page.goto('/cart');
      await expect(await card(page, failedA)).toHaveCount(0);
      await expect(await card(page, failedC)).toHaveCount(1);
    });

    test('only failed cards get a trash icon; pending, processing, unknown and paid never do', async ({ page }) => {
      await harness(page);
      const pendingId = '77777777-7777-4777-8777-777777777777'; const unknownId = '88888888-8888-4888-8888-888888888888'; const paidId = '99999999-9999-4999-8999-999999999999';
      await listRoute(page, () => [
        purchase(failedA, 'Failed item'),
        purchase(pendingId, 'Processing item', { state: 'PROCESSING', classification: 'PROCESSING', pending: true, retryAllowed: false }),
        purchase(unknownId, 'Unknown item', { state: 'PROCESSING', classification: 'UNKNOWN', pending: false, retryAllowed: false }),
        purchase(paidId, 'Paid item', { state: 'PAID', classification: 'SUCCEEDED', pending: false, retryAllowed: false, orderReference: 'ORD-1' }),
      ]);
      await page.goto('/cart');
      await expect(await card(page, failedA)).toHaveCount(1);
      await expect((await card(page, failedA)).getByRole('button', { name: /Remove failed payment/ })).toHaveCount(1);
      for (const id of [pendingId, unknownId, paidId]) {
        await expect((await card(page, id)).getByRole('button', { name: /Remove failed payment/ })).toHaveCount(0);
      }
    });
  });
}
