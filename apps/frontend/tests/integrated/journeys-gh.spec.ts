import { expect, test, type Page } from '@playwright/test';
import { addToCart, attemptRows, cartRows, customerEmail, emptyCart, fillCard, fillShipping, ledger, signIn, sql, stripeIntent } from './helpers';

test.describe.configure({ mode: 'serial' });
const cartState = (email: string) => ({ rows: cartRows(email), lines: sql(`SELECT count(*) FROM cart_items ci JOIN carts c ON c.id = ci."cartId" JOIN users u ON u.id = c."userId" WHERE u.email = '${email}'`) });
const badge = async (page: Page) => (await page.getByRole('link', { name: /^Cart/ }).first().getAttribute('aria-label')) ?? '';

async function buyNowToReview(page: Page, slug: string, card: string) {
  await page.goto(`/products/${slug}`);
  await page.getByRole('button', { name: 'Buy Now' }).click();
  await expect(page).toHaveURL(/\/checkout\/buy-now/);
  await fillShipping(page);
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled({ timeout: 60_000 });
  await fillCard(page, card);
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
}

test('Journey G: Buy Now with an empty Active Cart - success - the Active Cart stays empty at the database and in the header', async ({ page }) => {
  const email = customerEmail(6); emptyCart(email); await signIn(page, 6);
  const before = cartState(email); await page.goto('/'); const badgeBefore = await badge(page);
  await buyNowToReview(page, 'acceptance-speaker', '4242424242424242');
  expect(cartState(email)).toEqual(before); // between Review and Place Order nothing entered the Cart
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 120_000 });
  const attempt = attemptRows(email).at(-1)!; ledger({ journey: 'G', attempt: attempt.id, intent: attempt.intentId });
  expect(attempt.state).toBe('PAID'); expect((await stripeIntent(attempt.intentId)).status).toBe('succeeded');
  expect(sql(`SELECT scope FROM (SELECT a.request->>'scope' AS scope FROM payment_attempts a WHERE a.id = '${attempt.id}') s`)).toBe('BUY_NOW');
  expect(sql(`SELECT "cartId" IS NULL AND "activeCartId" IS NULL FROM payment_attempts WHERE id = '${attempt.id}'`)).toBe('t');
  expect(cartState(email)).toEqual(before);
  await page.goto('/cart'); expect(await badge(page)).toBe(badgeBefore);
  await expect(page.getByRole('heading', { name: /Pending purchases|Failed payments/ })).toHaveCount(0);
});

test('Journey H: Buy Now while Cart B holds merchandise - decline, Failed payments, Try Again, success - Cart B is identical throughout, including the same product', async ({ page }) => {
  const email = customerEmail(8); emptyCart(email); const token = await signIn(page, 8);
  await addToCart(page, token, 'AG-004', 2); await addToCart(page, token, 'AG-005', 1);
  const cartB = cartState(email); await page.goto('/cart'); const badgeB = await badge(page);
  // Same product through both paths (AG-004): purchase identity, not product name, separates them.
  await buyNowToReview(page, 'acceptance-headset', '4000000000000002');
  expect(cartState(email)).toEqual(cartB);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: /Payment Failed|Payment needs a different card|Payment did not complete/ })).toBeVisible({ timeout: 120_000 });
  const failed = attemptRows(email).at(-1)!; ledger({ journey: 'H', phase: 'buy-now-decline', attempt: failed.id, intent: failed.intentId });
  expect(cartState(email)).toEqual(cartB);
  // A Buy Now purchase is never restorable into the Cart, and no Restore action may be offered.
  await expect(page.getByRole('button', { name: 'Restore items to Cart' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Return to Cart' }).click();
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => badge(page), { timeout: 20_000 }).toBe(badgeB); expect(cartState(email)).toEqual(cartB);
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await page.getByRole('link', { name: /^Try Again/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible({ timeout: 60_000 });
  await expect(page.frameLocator('iframe[src*="elements-inner-accessory-target"]').getByLabel('Card number', { exact: true })).toHaveValue('');
  await fillCard(page, '4242424242424242');
  await page.getByRole('button', { name: 'Review Order' }).click();
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 120_000 });
  const paid = attemptRows(email).at(-1)!; ledger({ journey: 'H', phase: 'buy-now-retry-paid', attempt: paid.id, intent: paid.intentId });
  expect(paid.id).toBe(failed.id); expect(paid.state).toBe('PAID');
  expect((await stripeIntent(paid.intentId)).status).toBe('succeeded');
  expect(sql(`SELECT count(*) FROM orders o JOIN users u ON u.id = o."userId" WHERE u.email = '${email}'`)).toBe('1');
  expect(cartState(email)).toEqual(cartB); // active Cart rows identical to the pre-Buy-Now snapshot
  await page.goto('/cart'); await expect.poll(() => badge(page), { timeout: 20_000 }).toBe(badgeB);
  await expect(page.getByText('Acceptance Headset').first()).toBeVisible();
  await expect(page.getByText('Acceptance Mouse').first()).toBeVisible();
});
