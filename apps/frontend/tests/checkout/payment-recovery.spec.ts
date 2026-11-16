import { expect, test } from '@playwright/test';
import { harness, fillShipping, attemptId, paidConfirmation } from './stripe.harness';
import { cart } from '../../src/features/checkout/fixtures';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';

// Real browser lifecycle; authentication, backend and Stripe SDK are intercepted.
// No provider operation, database write or real financial acceptance is performed.
test('lost setup response retries the same persisted identity without submitting payment', async ({ page }) => {
  await harness(page);
  const keys: string[] = []; let creations = 0;
  await page.route('**/api/checkout/payment-attempts', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: [] } });
    const key = route.request().headers()['idempotency-key']; keys.push(key);
    if (keys.length === 1) { creations++; await route.abort('failed'); return; } // after simulated server persistence
    await route.fulfill({ json: { data: { attemptId, state: 'AWAITING_INPUT', providerStatus: 'requires_payment_method',
      failureCode: null, total: cart.total, currency: 'USD', orderReference: null, committed: false, cart,
      recoveryRemainder: null, recoveryActive: false, confirmation: null, clientSecret: 'pi_intercepted_secret_fixture', replayed: true } } });
  });
  await page.goto('/checkout'); await fillShipping(page);
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('button', { name: 'Retry payment setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry payment setup' }).click();
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]); expect(creations).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').confirms)).toBe(0);
});

test('actual tab close/reopen restores the unresolved owned purchase from its URL and never resubmits', async ({ page, context }) => {
  let paid = false; const submissions: string[] = [];
  // Scenario 1: the status URL redirects to Cart, where the owned saved purchase is observed through the shared list.
  const purchase = () => [savedPurchase(paid ? { state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: paidConfirmation.orderReference }
    : { state: 'CAPTURE_PENDING', classification: 'ORDER_PROCESSING' })];
  const prepare = async (target: typeof page) => {
    await target.clock.install();
    await harness(target);
    await routeSavedPurchases(target, purchase);
    target.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/checkout')) submissions.push(request.url()); });
  };
  await prepare(page); await page.goto(`/account/payment-status/${attemptId}`);
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  await page.close();
  const reopened = await context.newPage(); await prepare(reopened);
  await reopened.goto(`/account/payment-status/${attemptId}`);
  await expect(reopened).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(reopened.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  await expect(reopened.locator(`[data-purchase="${attemptId}"]`).getByText('Processing')).toBeVisible();
  expect(await reopened.evaluate(() => sessionStorage.getItem('electrohub:checkout:v1:11111111-1111-4111-8111-111111111111'))).toBeNull();
  await expect(reopened.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
  await reopened.screenshot({ path: 'test-results/checkout/reopened-unresolved.png', fullPage: true });
  // The verified outcome arrives through the bounded list observation, never through a resubmission.
  paid = true;
  await reopened.clock.runFor(15_001);
  await expect(reopened.locator(`[data-purchase="${attemptId}"][data-outcome="success"]`).getByRole('status')).toHaveText('Payment confirmed');
  expect(submissions).toEqual([]);
  await reopened.close();
});
