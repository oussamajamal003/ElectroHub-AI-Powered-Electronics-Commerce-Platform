import { expect, test } from '@playwright/test';
import { addToCart, attemptRows, cartRows, customerEmail, emptyCart, fillCard, ledger, signIn, sql, stripeIntent, toReview } from './helpers';

const email = customerEmail(3);
test.describe.configure({ mode: 'serial' });

test('Journey C: decline -> Try Again (fresh card entry) -> new card -> same attempt/PaymentIntent -> PAID, one order, Cart B untouched', async ({ page }) => {
  emptyCart(email); const token = await signIn(page, 3); await addToCart(page, token, 'AG-003', 1);
  const before = attemptRows(email).length;
  await toReview(page, '4000000000000002');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: /Payment Failed|Payment needs a different card|Payment did not complete/ })).toBeVisible({ timeout: 120_000 });
  const failed = attemptRows(email).at(-1)!; ledger({ journey: 'C', phase: 'decline', attempt: failed.id, intent: failed.intentId });
  // Cart B: the customer starts another purchase's Cart while the failed purchase waits in Failed payments.
  await page.getByRole('link', { name: 'Return to Cart' }).click();
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 60_000 });
  await addToCart(page, token, 'AG-004', 2); const cartB = cartRows(email);
  await page.reload();
  await page.getByRole('link', { name: /^Try Again/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible({ timeout: 60_000 });
  await expect(page.frameLocator('iframe[src*="elements-inner-accessory-target"]').getByLabel('Card number', { exact: true })).toHaveValue('');
  await expect(page.getByRole('heading', { name: /Review Your Order|Order Confirmed/ })).toHaveCount(0);
  await fillCard(page, '4242424242424242');
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 120_000 });
  const rows = attemptRows(email); const paid = rows.at(-1)!;
  expect(rows).toHaveLength(before + 1); expect(paid.id).toBe(failed.id); expect(paid.intentId).toBe(failed.intentId); // reuse contract
  expect(paid.state).toBe('PAID'); expect(paid.orderId).toBeTruthy();
  const intent = await stripeIntent(paid.intentId); expect(intent.status).toBe('succeeded'); expect(intent.amount_received).toBe(intent.amount);
  expect(sql(`SELECT count(*) FROM orders o JOIN users u ON u.id = o."userId" WHERE u.email = '${email}'`)).toBe('1');
  expect(cartRows(email)).toEqual(cartB); // the saved purchase never touched Cart B
  ledger({ journey: 'C', phase: 'retry-paid', attempt: paid.id, intent: paid.intentId });
});
