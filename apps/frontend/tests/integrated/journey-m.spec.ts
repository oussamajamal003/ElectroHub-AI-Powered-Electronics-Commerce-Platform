import { expect, test } from '@playwright/test';
import { addToCart, attemptRows, customerEmail, emptyCart, ledger, signIn, sql, stripeIntent, toReview, waitFor } from './helpers';

test.describe.configure({ mode: 'serial' });

test('Journey M1: normal Place Order records the signal before Stripe confirms, then reaches PAID', async ({ page }) => {
  const email = customerEmail(19); emptyCart(email); const token = await signIn(page, 19); await addToCart(page, token, 'AG-001', 1);
  await toReview(page, '4242424242424242');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 120_000 });
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'M1', attempt: attempt.id, intent: attempt.intentId });
  expect(attempt.state).toBe('PAID');
  expect(sql(`SELECT "confirmationStartedAt" IS NOT NULL AND "confirmationStartedAt" >= "submittedAt" FROM payment_attempts WHERE id = '${attempt.id}'`)).toBe('t');
  expect((await stripeIntent(attempt.intentId)).status).toBe('succeeded');
});

test('Journey M2: if the signal cannot be recorded, Stripe confirmation is never started and the purchase shows Processing (checking), never Checkout saved', async ({ page }) => {
  const email = customerEmail(20); emptyCart(email); const token = await signIn(page, 20); await addToCart(page, token, 'AG-002', 1);
  await page.route('**/confirmation-started', route => route.abort());
  await toReview(page, '4242424242424242');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await waitFor(() => attemptRows(email).at(-1)?.state === 'AWAITING_INPUT' && sql(`SELECT "submittedAt" IS NOT NULL FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = '${email}'`) === 't', 60_000, 'submitted');
  await page.waitForTimeout(15_000); // outlasts both the post and the status-read/retry attempts
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'M2', attempt: attempt.id, intent: attempt.intentId });
  const intent = await stripeIntent(attempt.intentId);
  expect(intent.status).toBe('requires_payment_method'); expect(intent.amount_received).toBe(0); // Stripe was never asked to confirm
  expect(sql(`SELECT "confirmationStartedAt" IS NULL FROM payment_attempts WHERE id = '${attempt.id}'`)).toBe('t');
  await page.unroute('**/confirmation-started');
  await page.goto('/cart');
  const card = page.locator(`[data-purchase="${attempt.id}"]`);
  await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/Checking the status of this purchase/)).toBeVisible();
  await expect(card.getByRole('link', { name: 'Check payment status' })).toBeVisible();
  await expect(page.getByText('Checkout saved')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Continue to payment/ })).toHaveCount(0);
});
