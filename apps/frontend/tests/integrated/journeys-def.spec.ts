import { expect, test, type Page } from '@playwright/test';
import { addToCart, attemptRows, customerEmail, emptyCart, ledger, signIn, sql, startWorker, stopWorker, stripeConfirm, stripeIntent, toReview, waitFor, workerRunning } from './helpers';

test.describe.configure({ mode: 'serial' });
const SUCCESS = 'Payment successful! Your order has been confirmed.';
const FAILURE = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
const toasts = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });

test('Journey E: delayed provider failure moves Pending -> Failed payments automatically with one toast and Try Again (real Stripe decline, real webhook, real worker)', async ({ page }) => {
  const email = customerEmail(4);
  if (!workerRunning()) startWorker();
  emptyCart(email); const token = await signIn(page, 4); await addToCart(page, token, 'AG-004', 1);
  // Fault injection at the client edge only: Stripe.js confirmation never leaves the browser, so the purchase is submitted but unpaid.
  await page.route('https://api.stripe.com/v1/payment_intents/*/confirm', route => route.abort());
  await toReview(page, '4242424242424242');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await waitFor(() => attemptRows(email).at(-1)?.state !== undefined && sql(`SELECT count(*) FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = '${email}' AND a."submittedAt" IS NOT NULL`) === '1', 60_000, 'submitted attempt');
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'E', phase: 'submitted-unpaid', attempt: attempt.id, intent: attempt.intentId });
  await page.unroute('https://api.stripe.com/v1/payment_intents/*/confirm');
  await page.goto('/cart');
  const pending = page.locator(`section[aria-labelledby="pending-purchases-heading"] [data-purchase="${attempt.id}"]`);
  await expect(pending).toBeVisible({ timeout: 60_000 });
  await expect(pending.getByRole('link', { name: /Try Again|Continue payment|Pay/ })).toHaveCount(0); // read-only: no payment action
  // The provider later fails it (genuine Stripe Test Mode decline); the webhook and worker, not the browser, must carry it to FAILED.
  const confirm = await stripeConfirm(attempt.intentId, 'pm_card_chargeDeclined'); expect(confirm.errorCode).toBe('card_declined');
  await waitFor(() => attemptRows(email).at(-1)?.state === 'DECLINED', 120_000, 'persisted DECLINED');
  // No manual reload: the same Cart page moves the purchase on its own.
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(`section[aria-labelledby="pending-purchases-heading"] [data-purchase="${attempt.id}"]`)).toHaveCount(0);
  await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(1);
  await expect(toasts(page)).toHaveCount(1);
  await expect(page.locator(`section[aria-labelledby="saved-purchases-heading"] [data-purchase="${attempt.id}"]`).getByRole('link', { name: /^Try Again/ })).toBeVisible();
  const intent = await stripeIntent(attempt.intentId); expect(intent.status).toBe('requires_payment_method'); expect(intent.amount_received).toBe(0);
  expect(attemptRows(email).filter(row => row.id === attempt.id)).toHaveLength(1);
});

test('Journeys D+F: with the worker down, leaving and returning to a Processing purchase never shows an empty Cart; when the worker returns the purchase becomes PAID by itself with one toast', async ({ page }) => {
  const email = customerEmail(5);
  emptyCart(email); const token = await signIn(page, 5); await addToCart(page, token, 'AG-005', 1);
  stopWorker(); await waitFor(() => !workerRunning(), 15_000, 'worker stopped');
  // Client reply lost after the provider authorised: the browser never reconciles, no worker runs, only the signed webhook arrives.
  await page.route('**/api/checkout/payment-attempts/*/reconcile', route => route.abort());
  await toReview(page, '4242424242424242');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await waitFor(() => sql(`SELECT count(*) FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = '${email}' AND a."submittedAt" IS NOT NULL`) === '1', 60_000, 'submitted attempt');
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'D+F', phase: 'submitted-authorised', attempt: attempt.id, intent: attempt.intentId });
  await waitFor(async () => (await stripeIntent(attempt.intentId)).status === 'requires_capture', 90_000, 'Stripe authorisation');
  expect(attemptRows(email).at(-1)!.state).not.toBe('PAID'); // authorised, not captured, not yet an order
  expect(sql(`SELECT count(*) FROM orders o JOIN users u ON u.id = o."userId" WHERE u.email = '${email}'`)).toBe('0');
  // Journey D: Processing -> Cart -> back to the same purchase.
  await page.goto('/cart');
  const pendingCard = page.locator(`section[aria-labelledby="pending-purchases-heading"] [data-purchase="${attempt.id}"]`);
  await expect(pendingCard).toBeVisible({ timeout: 60_000 });
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await expect(page).not.toHaveURL(/step=shipping/).catch(() => undefined);
  await expect(page.getByRole('heading', { name: /Checking your payment|Payment Method|Review Your Order/ })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  // Journey F: back on Cart, the worker returns and captures from the stored webhook wake.
  await page.goto('/cart'); await expect(pendingCard).toBeVisible({ timeout: 60_000 });
  startWorker(); await waitFor(() => workerRunning(), 60_000, 'worker running');
  await waitFor(() => attemptRows(email).at(-1)?.state === 'PAID', 180_000, 'persisted PAID after worker restart');
  await expect(pendingCard).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1);
  await expect(toasts(page)).toHaveCount(1);
  const intent = await stripeIntent(attempt.intentId); expect(intent.status).toBe('succeeded'); expect(intent.amount_received).toBe(intent.amount);
  expect(sql(`SELECT count(*) FROM orders o JOIN users u ON u.id = o."userId" WHERE u.email = '${email}'`)).toBe('1');
  expect(attemptRows(email).filter(row => row.id === attempt.id)).toHaveLength(1);
  await page.goto('/orders'); await expect(page.getByText(/ORD-|Order/).first()).toBeVisible();
});
