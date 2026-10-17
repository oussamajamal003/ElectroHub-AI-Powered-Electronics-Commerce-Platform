import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addToCart, attemptRows, customerEmail, emptyCart, ledger, shipping, signIn, sql, stripeConfirm, stripeIntent, waitFor } from './helpers';

/** Submitted through the real API (no browser Stripe.js, so nothing can retry a confirmation): AWAITING_INPUT, submitted, no card, nothing charged. */
test('Journey K: submitted purchase with no card shows Processing with honest checking copy and only Check payment status; a later real outcome reconciles', async ({ page }) => {
  const n = Number(process.env.JOURNEY_CUSTOMER ?? 15); const email = customerEmail(n);
  emptyCart(email); const token = await signIn(page, n); await addToCart(page, token, 'AG-005', 1);
  const headers = { Authorization: `Bearer ${token}` };
  const cart = (await (await page.request.get('/api/cart', { headers })).json()).data;
  const setup = await page.request.post('/api/checkout/payment-attempts', { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision } });
  expect(setup.status(), await setup.text()).toBeLessThan(300);
  const id = (await setup.json()).data.attemptId; expect((await page.request.post(`/api/checkout/payment-attempts/${id}/submit`, { headers, data: {} })).status()).toBeLessThan(300);
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'K', attempt: attempt.id, intent: attempt.intentId });
  expect(attempt.state).toBe('AWAITING_INPUT'); expect((await stripeIntent(attempt.intentId)).amount_received).toBe(0);

  await page.goto('/cart');
  const card = page.locator(`[data-purchase="${attempt.id}"]`);
  await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/Checking the status of this purchase/)).toBeVisible();
  await expect(page.getByText('Checkout saved')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Continue to payment/ })).toHaveCount(0);
  await page.reload(); await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 60_000 });
  // Check payment status observes only: it never opens card entry or asks Stripe to confirm.
  await card.getByRole('link', { name: 'Check payment status' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toHaveCount(0);
  expect(attemptRows(email).at(-1)?.state).toBe('AWAITING_INPUT'); expect((await stripeIntent(attempt.intentId)).status).toBe('requires_payment_method');

  // Background reconciliation: a real provider confirmation made elsewhere moves the same card to its outcome and the Cart updates.
  await page.goto('/cart'); await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 60_000 });
  expect((await stripeConfirm(attempt.intentId, 'pm_card_visa')).status).toBe('requires_capture');
  await waitFor(() => attemptRows(email).at(-1)?.state === 'PAID', 180_000, 'persisted PAID');
  await expect(card).toHaveCount(0, { timeout: 90_000 });
  expect(sql(`SELECT count(*) FROM orders WHERE id = '${attemptRows(email).at(-1)!.orderId}'`)).toBe('1');
});
