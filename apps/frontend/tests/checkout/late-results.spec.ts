import { expect, test, type Page } from '@playwright/test';
import { harness } from './stripe.harness';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';
import type { SavedPurchase } from '../../src/features/checkout/PaymentPurchases';

// INTERCEPTED APIs (real Chromium, real app, controlled page clock). A result "arriving after five minutes"
// is simulated with the page clock; no real waiting, no provider calls, no database writes.
const close = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });
const success = 'Payment successful! Your order has been confirmed.';
const failure = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
const pendingA = savedPurchase({ state: 'PROCESSING', classification: 'PROCESSING', items: [{ name: 'Pending Product A', quantity: 2 }] });
const terminal = (state: 'PAID' | 'DECLINED'): SavedPurchase => ({ ...pendingA, state, classification: state === 'PAID' ? 'SUCCEEDED' : 'DECLINED',
  pending: false, unread: true, retryAllowed: state === 'DECLINED', orderReference: state === 'PAID' ? 'ORD-LATE-A' : null });

async function pendingOnHome(page: Page) {
  await page.clock.install();
  await harness(page);
  let rows: SavedPurchase[] | { status: number } = [pendingA];
  const reads = await routeSavedPurchases(page, () => rows);
  await page.goto('/');
  await expect.poll(() => reads.count).toBeGreaterThan(0);
  // The tab keeps watching past the five-minute observation window (one due read fires on the jump).
  const watched = reads.count; await page.clock.fastForward(6 * 60_000);
  await expect.poll(() => reads.count).toBeGreaterThan(watched);
  await expect(page.getByText('Pending Product A')).toHaveCount(0); // Home shows no pending banner
  return { reads, set: (next: typeof rows) => { rows = next; } };
}
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

for (const state of ['PAID', 'DECLINED'] as const) {
  test(`${state} after the five-minute window is discovered on Home without a manual refresh, once`, async ({ page }) => {
    const flow = await pendingOnHome(page);
    flow.set([terminal(state)]);
    const before = flow.reads.count;
    await page.clock.fastForward(60_001); // backed-off read
    await expect.poll(() => flow.reads.count).toBeGreaterThan(before);
    await expect(page.locator('li[data-state="open"]').getByText(state === 'PAID' ? success : failure, { exact: true })).toBeVisible();
    await expect(close(page)).toHaveCount(1);
    if (state === 'PAID') await expect(page.getByRole('link', { name: 'View Order' })).toHaveAttribute('href', '/checkout/confirmation/ORD-LATE-A');
    await page.screenshot({ path: `screenshots/scenario1-final/late-${state}-home-toast.png` });
    // Close icon dismisses immediately; later reads never bring it back.
    await close(page).click(); await expect(close(page)).toHaveCount(0);
    await page.clock.fastForward(130_000); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(500);
    await expect(close(page)).toHaveCount(0);
  });
}

test('a hidden tab is not polled; returning to the tab discovers the late result', async ({ page }) => {
  const flow = await pendingOnHome(page);
  await setHidden(page, true);
  flow.set([terminal('DECLINED')]);
  const hiddenReads = flow.reads.count;
  await page.clock.fastForward(10 * 60_000);
  expect(flow.reads.count).toBe(hiddenReads); // no promise of delivery while inactive
  await expect(close(page)).toHaveCount(0);
  await setHidden(page, false);
  await expect.poll(() => flow.reads.count).toBeGreaterThan(hiddenReads);
  await expect(close(page)).toHaveCount(1);
  await expect(page.locator('li[data-state="open"]').getByText(failure, { exact: true })).toBeVisible();
});

test('navigation discovers a late result and the auto-dismiss happens at five seconds', async ({ page }) => {
  const flow = await pendingOnHome(page);
  flow.set([terminal('PAID')]);
  await page.clock.fastForward(20_000); // the backed-off read is not due yet
  const before = flow.reads.count;
  await page.getByRole('link', { name: 'Products', exact: true }).first().click();
  await expect.poll(() => flow.reads.count).toBeGreaterThan(before);
  await expect(close(page)).toHaveCount(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
  await page.clock.runFor(2_500); await expect(close(page)).toHaveCount(1);
  await page.clock.runFor(3_000); await expect(close(page)).toHaveCount(0);
});

test('UNKNOWN and 503 keep the purchase pending in Cart with no toast and no Try Again', async ({ page }) => {
  await page.clock.install(); await harness(page);
  let rows: SavedPurchase[] | { status: number } = [{ ...pendingA, classification: 'UNKNOWN' }];
  const reads = await routeSavedPurchases(page, () => rows);
  await page.goto('/cart');
  await expect(page.getByText('Awaiting confirmation')).toBeVisible();
  rows = { status: 503 }; const before = reads.count;
  await page.clock.fastForward(15_001); await expect.poll(() => reads.count).toBeGreaterThan(before);
  await expect(page.getByText(/could not be updated/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  await expect(page.getByText('Awaiting confirmation')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toHaveCount(0);
  await expect(close(page)).toHaveCount(0);
});

for (const width of [390, 768, 1440, 1920]) {
  test(`pending → failed card transition and terminal success at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.clock.install(); await harness(page);
    const pendingB = { ...pendingA, attemptId: '56565656-5656-4565-8565-565656565656', items: [{ name: 'Pending Product B', quantity: 1 }] };
    let rows: SavedPurchase[] = [pendingA, pendingB];
    const reads = await routeSavedPurchases(page, () => rows);
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
    await expect(page.locator('article[data-tone="pending"]')).toHaveCount(2);
    await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `screenshots/scenario1-final/late-cart-pending-${width}.png`, fullPage: true });
    // 7. A fails: it leaves Pending (clean exit) and appears under Failed payments with a backend-authorized Try Again.
    rows = [terminal('DECLINED'), pendingB]; let before = reads.count;
    await page.clock.fastForward(15_001); await expect.poll(() => reads.count).toBeGreaterThan(before);
    await page.clock.fastForward(451);
    await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
    await expect(page.locator(`article[data-tone="failure"][data-purchase="${pendingA.attemptId}"]`)).toBeVisible();
    await expect(page.locator('article[data-tone="pending"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
    await page.clock.fastForward(5_001); // let the failure toast auto-dismiss before capturing
    await page.screenshot({ path: `screenshots/scenario1-final/late-cart-failed-${width}.png`, fullPage: true });
    // 13. B is paid: it leaves Pending, never offers Try Again, and the toast links to the order.
    rows = [terminal('DECLINED'), { ...pendingB, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: 'ORD-B' }];
    before = reads.count; await page.clock.fastForward(15_001); await expect.poll(() => reads.count).toBeGreaterThan(before);
    await expect(page.getByRole('link', { name: 'View Order' })).toHaveAttribute('href', '/checkout/confirmation/ORD-B');
    await page.clock.fastForward(451);
    await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
    await expect(page.getByText('Pending Product B')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
    await page.screenshot({ path: `screenshots/scenario1-final/late-cart-paid-toast-${width}.png`, fullPage: true });
  });
}
