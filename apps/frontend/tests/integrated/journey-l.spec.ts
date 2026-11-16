import { expect, test } from '@playwright/test';
import { addToCart, attemptRows, cartRows, customerEmail, emptyCart, ledger, signIn, sql, toReview } from './helpers';

test('Journey L: leaving Checkout before Place Order never creates a customer-visible pending purchase and keeps the Cart intact', async ({ page }) => {
  const n = Number(process.env.JOURNEY_CUSTOMER ?? 17); const email = customerEmail(n);
  emptyCart(email); const token = await signIn(page, n); await addToCart(page, token, 'AG-006', 1);
  await toReview(page, '4242424242424242'); // Shipping → Delivery → Payment (card typed) → Review; Place Order is NOT clicked
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'L', attempt: attempt.id, intent: attempt.intentId });
  expect(sql(`SELECT "submittedAt" IS NULL FROM payment_attempts WHERE id = '${attempt.id}'`)).toBe('t');
  for (const route of ['/cart', '/products', '/cart']) {
    await page.goto(route); await page.reload();
    await expect(page.locator('[data-purchase]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  }
  expect(cartRows(email)).toContain('AG-006:1');
  const list = await (await page.request.get('/api/checkout/payment-attempts', { headers: { Authorization: `Bearer ${token}` } })).json();
  expect(list.data).toHaveLength(0);
  expect(sql(`SELECT count(*) FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = '${email}' AND a."submittedAt" IS NOT NULL`)).toBe('0');
  expect(attemptRows(email).at(-1)?.state).toBe('AWAITING_INPUT'); // not cancelled, not failed: the draft stays recoverable
});
