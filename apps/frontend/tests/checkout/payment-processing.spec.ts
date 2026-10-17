import { expect, test } from '@playwright/test';
import { attemptId, harness, paidConfirmation, review } from './stripe.harness';
import { cart } from '../../src/features/checkout/fixtures';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';

for (const state of ['PAID', 'DECLINED'] as const) {
  // Scenario 1: recovery keeps the shared Processing presentation until the verified terminal UI.
  test(`intercepted delayed ${state}: only the shared Processing presentation, then the terminal UI`, async ({ page }) => {
    await page.setViewportSize({ width: state === 'PAID' ? 1440 : 390, height: 900 });
    await page.clock.install();
    const api = await harness(page, { state: 'PROCESSING' });
    api.hold();
    let terminal = false; let statusReads = 0; let terminalDeliveryAt = 0;
    await page.route(`**/api/checkout/payment-attempts/${attemptId}`, async route => {
      statusReads++;
      if (terminal) terminalDeliveryAt = await page.evaluate(() => performance.now());
      await route.fulfill({ json: { data: { attemptId, state: terminal ? state : 'PROCESSING', recoveryActive: !terminal,
        providerStatus: terminal ? state === 'PAID' ? 'succeeded' : 'requires_payment_method' : 'processing',
        failureCode: terminal && state === 'DECLINED' ? 'PAYMENT_DECLINED' : null,
        total: cart.total, currency: 'USD', orderReference: terminal && state === 'PAID' ? paidConfirmation.orderReference : null,
        committed: terminal && state === 'PAID', cart, recoveryRemainder: null,
        confirmation: terminal && state === 'PAID' ? paidConfirmation : null } } });
    });
    await page.goto('/checkout'); await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect(page.getByRole('heading', { name: 'Processing your order…' })).toBeVisible();
    api.release();
    // Stage 2 once Place Order settles unresolved: the verification view, never a permanent Stage 1.
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await page.clock.fastForward(16_000);
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await expect(page.getByText(/verification is taking longer/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check payment status' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Return to Cart' })).toHaveCount(0);
    await page.screenshot({ path: `test-results/checkout/task-03.6-processing-${state}.png`, fullPage: true });
    terminal = true;
    const readsBeforeTerminal = statusReads;
    await page.clock.runFor(15001);
    await expect(page.getByRole('heading', { name: state === 'PAID' ? 'Order Confirmed!' : 'Payment Failed' })).toBeVisible();
    expect(statusReads - readsBeforeTerminal).toBe(1);
    console.log(`INTERCEPTED ${state}: terminal response → UI ${Math.round(await page.evaluate(() => performance.now()) - terminalDeliveryAt)}ms; no second terminal GET`);
    expect(await api.confirms()).toBe(1);
  });
}

test('intercepted unknown payment leaves bounded Checkout loading for the non-blocking saved purchase in Cart', async ({ page }) => {
  await page.clock.install();
  const api = await harness(page, { state: 'CAPTURE_PENDING' });
  const list = await routeSavedPurchases(page, () => [savedPurchase({ classification: 'UNKNOWN' })]);
  await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  // Scenario 1: the bounded 120-second Checkout observation hands off to Cart, keeping the attempt identity.
  await page.clock.fastForward(121_000);
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  await expect(page.getByText('Awaiting confirmation')).toBeVisible();
  const checkoutPosts = () => api.requests.filter(request => request.method === 'POST' && request.path.startsWith('/api/checkout')).length;
  const postsAtHandoff = checkoutPosts();
  await page.reload();
  await expect(page.getByText('Awaiting confirmation')).toBeVisible();
  // Reads stay bounded: the owned status endpoint is not polled outside Checkout and the shared
  // list keeps observing a pending purchase at a bounded rate (every 15 s while visible; owner contract since 2026-10-14 18:51).
  const statusReads = () => api.requests.filter(request => request.path === `/api/checkout/payment-attempts/${attemptId}`).length;
  const statusBefore = statusReads();
  await page.clock.fastForward(5 * 60_000 + 1_000);
  const listReads = list.count;
  await page.clock.runFor(31_000);
  expect(statusReads()).toBe(statusBefore);
  expect(list.count - listReads).toBeLessThanOrEqual(3); // at most one read per 15 s over 31 s: no request storm
  expect(checkoutPosts()).toBe(postsAtHandoff);
  await expect(page.getByRole('link', { name: 'Try Again' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore Products' }).click();
  await expect(page).toHaveURL(/\/products$/);
});

test('intercepted unavailable saved purchases offer a safe retry without an automatic request loop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await harness(page, { state: 'CAPTURE_PENDING' });
  const list = await routeSavedPurchases(page, () => ({ status: 503 }));
  // Scenario 1: the legacy status URL redirects to Cart; it never becomes a financial request.
  await page.goto(`/account/payment-status/${attemptId}`);
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(page.getByText('Saved purchases could not be loaded.')).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeEnabled();
  const initialReads = list.count;
  await page.clock.runFor(16_000);
  expect(list.count).toBe(initialReads);
  await page.screenshot({ path: 'test-results/checkout/task-03.6-saved-purchases-unavailable-390.png', fullPage: true });
  await retry.click();
  await expect.poll(() => list.count).toBe(initialReads + 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/checkout/task-03.6-saved-purchases-unavailable-1440.png', fullPage: true });
  await expect(page.getByRole('link', { name: 'Try Again' })).toHaveCount(0);
});
