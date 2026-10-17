import { expect, test } from '@playwright/test';
import { addToCart, attemptRows, customerEmail, emptyCart, ledger, signIn, sql, stripeIntent, toReview } from './helpers';

const customer = Number(process.env.JOURNEY_CUSTOMER ?? 1);
const email = customerEmail(customer);
test.describe.configure({ mode: 'serial' });

test('Journey A: Cart checkout with 4242 reaches PAID in Stripe, PostgreSQL and the UI', async ({ page }) => {
  emptyCart(email); const token = await signIn(page, customer); await addToCart(page, token, 'AG-001', 1);
  const before = attemptRows(email).length;
  await toReview(page, '4242424242424242');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 120_000 });
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'A', attempt: attempt.id, intent: attempt.intentId, card: '4242' });
  expect(attemptRows(email)).toHaveLength(before + 1);
  expect(attempt.state).toBe('PAID'); expect(attempt.orderId).toBeTruthy();
  const intent = await stripeIntent(attempt.intentId); expect(intent.status).toBe('succeeded'); expect(intent.amount_received).toBe(intent.amount);
  expect(sql(`SELECT count(*) FROM orders WHERE id = '${attempt.orderId}'`)).toBe('1');
});

test('Journey B: declined card (4000000000000002) fails everywhere, with Try Again and fresh card entry', async ({ page }) => {
  emptyCart(email); const token = await signIn(page, customer); await addToCart(page, token, 'AG-002', 1);
  const before = attemptRows(email).length;
  await toReview(page, '4000000000000002');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: /Payment Failed|Payment needs a different card|Payment did not complete/ })).toBeVisible({ timeout: 120_000 });
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'B', attempt: attempt.id, intent: attempt.intentId, card: '0002' });
  expect(attemptRows(email)).toHaveLength(before + 1);
  expect(['DECLINED', 'AWAITING_INPUT']).toContain(attempt.state);
  const intent = await stripeIntent(attempt.intentId); expect(intent.status).toBe('requires_payment_method'); expect(intent.amount_received).toBe(0);
  await page.getByRole('link', { name: 'Return to Cart' }).click();
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Try Again/ })).toBeVisible();
  await page.getByRole('link', { name: /^Try Again/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible({ timeout: 60_000 });
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  await expect(frame.getByLabel('Card number', { exact: true })).toHaveValue('');
  await expect(page).not.toHaveURL(/confirmation/);
  expect(attemptRows(email)).toHaveLength(before + 1); // same attempt, no new PaymentIntent
});
