import { test, expect } from '@playwright/test';
import { harness, review, fillCard, attemptId } from './stripe.harness';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';
import { cart, confirmation } from '../../src/features/checkout/fixtures';
import { CHECKOUT_RECOVERY_WINDOW_MS } from '../../src/features/checkout/paymentPresentation';

test.describe('TASK 03.6 — Critical Checkout State & Payment Recovery Bug Verification', () => {

  test('BUG 1: Confirmed decline displays Payment Failed immediately, stops polling, and has functional Try Again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page, { state: 'DECLINED' });

    await page.goto('/checkout');
    await review(page);

    // Track status polling requests after placing order
    const statusRequests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/checkout/payment-attempts/') && req.method() === 'GET') {
        statusRequests.push(req.url());
      }
    });

    await page.getByRole('button', { name: /Place Order/ }).click();

    // 1. Immediately displays Payment Failed (never remains frozen on Checking...)
    const failedHeading = page.getByRole('heading', { name: 'Payment Failed' });
    await expect(failedHeading).toBeVisible({ timeout: 5000 });

    // Verify the verification view is completely absent once the decline is confirmed
    await expect(page.getByRole('heading', { name: /Checking your payment|We couldn’t confirm your payment yet/ })).toHaveCount(0);

    // 2. Functional Try Again button is visible and enabled
    const tryAgainBtn = page.getByRole('button', { name: 'Try Again' });
    await expect(tryAgainBtn).toBeVisible();
    await expect(tryAgainBtn).toBeEnabled();

    // 3. Status polling stops (no infinite polling)
    const countBefore = statusRequests.length;
    await page.waitForTimeout(3000);
    const countAfter = statusRequests.length;
    // Should not poll indefinitely while in DECLINED terminal failure
    expect(countAfter - countBefore).toBeLessThanOrEqual(1);

    // 4. Try Again returns to Payment step with functional card entry
    await tryAgainBtn.click();
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeVisible({ timeout: 5000 });
  });

  test('unresolved capture survives leaving and re-entering Checkout without another setup or authorization', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const api = await harness(page, { state: 'CAPTURE_PENDING' });
    // The durable unresolved purchase is owned by the shared saved-purchases list (Cart), not by a Checkout draft.
    await routeSavedPurchases(page, () => [savedPurchase({ state: 'CAPTURE_PENDING', classification: 'ORDER_PROCESSING' })]);

    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();

    // Stage 2 verification is actively displayed
    const checkingHeading = page.getByRole('heading', { name: 'Checking your payment' });
    await expect(checkingHeading).toBeVisible({ timeout: 5000 });

    // User leaves Checkout by navigating to Home
    await page.goto('/');
    await expect(page).toHaveURL('/');

    // Recovery is required here. Only authoritative terminal state may unlock retry.
    await page.addInitScript(() => {
      const flashes: string[] = [];
      Reflect.set(window, '__verificationFlashes', flashes);
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            const text = node.textContent ?? '';
            if (text.includes('Payment Failed') || text.includes('Order Confirmed!') || text.includes('Shipping Information')) {
              flashes.push(text);
            }
          }
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });

    const setupCount = api.requests.filter(req => req.method === 'POST' && req.path === '/api/checkout/payment-attempts').length;
    await page.goto('/checkout');
    // Submitted A left the active Cart; re-entering Checkout neither replays A nor starts a payment for it.
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
    const capturedFlashes = await page.evaluate(() => Reflect.get(window, '__verificationFlashes') as string[]);
    expect(capturedFlashes).toHaveLength(0);
    expect(api.requests.filter(req => req.method === 'POST' && req.path === '/api/checkout/payment-attempts')).toHaveLength(setupCount);
    expect(api.requests.filter(req => req.path.endsWith('/submit'))).toHaveLength(1);
    expect(await api.confirms()).toBe(0); // This document has not submitted another authorization.
    // The same attempt identity survives as a non-retryable pending purchase in Cart.
    await page.goto('/cart');
    const pendingA = page.locator(`article[data-purchase="${attemptId}"]`);
    await expect(pendingA).toBeVisible();
    await expect(pendingA).toHaveAttribute('data-tone', 'pending');
    await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(0);
  });

  test('BOUNDED WAITING: Prolonged verification provides working recovery path and never remains frozen indefinitely', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.install();

    // Mock an attempt that remains in CAPTURE_PENDING
    await harness(page, { state: 'CAPTURE_PENDING' });
    await routeSavedPurchases(page, () => [savedPurchase({ state: 'CAPTURE_PENDING', classification: 'ORDER_PROCESSING' })]);

    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();

    // Initially shows the animated verification view without payment actions
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Check payment status' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);

    // Bounded: after the Checkout observation window the purchase is handed to Cart with its identity,
    // where it keeps being observed as a pending, non-retryable purchase (never frozen, never a failure).
    await page.clock.fastForward(CHECKOUT_RECOVERY_WINDOW_MS + 1000);
    await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
    await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
    await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveAttribute('data-tone', 'pending');
    // Safe navigation away remains available (active Cart is empty, so its own browse action is shown).
    await expect(page.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
    await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check payment status' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
  });

  test('End-to-End: Decline → Try Again → card entry on the SAME attempt → Order Confirmation without duplicate setup, submission or order', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page, { state: 'DECLINED' });

    const firstId = '44444444-4444-4444-8444-444444444444';
    const keys: string[] = [];
    const reconciled: string[] = [];
    const submittedAt = new Date().toISOString();
    const base = {
      state: 'AWAITING_INPUT', providerStatus: 'requires_payment_method', failureCode: null, total: cart.total, submittedAt: null as string | null,
      currency: 'USD', orderReference: null, committed: false, cart, recoveryRemainder: null, recoveryActive: false, confirmation: null
    };

    await page.route('**/api/checkout/payment-attempts', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      keys.push(route.request().headers()['idempotency-key']);
      await route.fulfill({ status: 201, json: { data: { ...base, attemptId: firstId, clientSecret: `pi_${firstId}_secret_intercepted`, replayed: false } } });
    });

    await page.route('**/api/checkout/payment-attempts/*/reconcile', async route => {
      const reqAttemptId = new URL(route.request().url()).pathname.split('/').at(-2)!;
      reconciled.push(reqAttemptId);
      // A submitted attempt always carries submittedAt from the backend.
      if (reconciled.length === 1) {
        await route.fulfill({ json: { data: { ...base, attemptId: reqAttemptId, submittedAt, state: 'DECLINED', failureCode: 'PAYMENT_DECLINED', retryAllowed: true } } });
      } else {
        await route.fulfill({
          json: {
            data: {
              ...base, attemptId: reqAttemptId, submittedAt, state: 'PAID', committed: true, providerStatus: 'succeeded',
              cart: { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false },
              orderReference: confirmation.orderReference, confirmation: { ...confirmation, paymentState: 'PAID' }
            }
          }
        });
      }
    });

    await page.goto('/checkout');
    await page.evaluate(() => { Reflect.get(window, '__stripeFixture').behavior = 'decline'; });
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();

    // 1. Confirmed decline
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();

    // 2. Try Again
    await page.evaluate(() => { Reflect.get(window, '__stripeFixture').behavior = 'success'; });
    const tryAgainBtn = page.getByRole('button', { name: 'Try Again' });
    await tryAgainBtn.click();

    // 3. Restored Payment step for the SAME saved attempt (resume), then new card details
    await expect(page).toHaveURL(/\/checkout[?]step=payment$/);
    await expect(page.getByText('Retrying payment for this purchase')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    await fillCard(page);
    await page.getByRole('button', { name: 'Review Order' }).click();

    // 4. Places the order again on the same attempt and PaymentIntent
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
    await page.getByRole('button', { name: /Place Order/ }).click();

    // 5. Lands on Confirmation
    await expect(page.getByRole('heading', { name: /Order Confirmed/i })).toBeVisible({ timeout: 10000 });

    // One setup key (no new attempt), one submission, both reconciles for the same attempt, one confirmation per Place Order.
    expect(keys).toHaveLength(1);
    expect(reconciled).toEqual([firstId, firstId]);
    expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').confirms as number)).toBe(2);
  });

});
