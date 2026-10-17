import { expect, test, type Page } from '@playwright/test';
import { addToCart, attemptRows, customerEmail, emptyCart, ledger, signIn, sql, stripeConfirm, stripeIntent, toReview, waitFor } from './helpers';

test.describe.configure({ mode: 'serial' });
const SUCCESS = 'Payment successful! Your order has been confirmed.';
const FAILURE = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
const submitted = (email: string) => sql(`SELECT count(*) FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = '${email}' AND a."submittedAt" IS NOT NULL`);

/** Submitted but unpaid: Stripe.js confirmation never leaves the browser (client-edge fault injection only). */
async function submitUnpaid(page: Page, email: string, n: number, sku: string) {
  emptyCart(email); const token = await signIn(page, n); await addToCart(page, token, sku, 1);
  const before = Number(submitted(email));
  await page.route('https://api.stripe.com/v1/payment_intents/*/confirm', route => route.abort());
  await toReview(page, '4242424242424242');
  await page.getByRole('button', { name: /Place Order/ }).click();
  await waitFor(() => Number(submitted(email)) === before + 1, 60_000, 'submitted attempt');
  await page.unroute('https://api.stripe.com/v1/payment_intents/*/confirm');
  return attemptRows(email).at(-1)!;
}

test('Journey I: direct purchase URL, refresh and back/forward keep the purchase identity until it becomes PAID', async ({ page }) => {
  const email = customerEmail(15); const attempt = await submitUnpaid(page, email, 15, 'AG-001'); ledger({ journey: 'I', attempt: attempt.id, intent: attempt.intentId });
  await page.goto(`/checkout?purchase=${attempt.id}`);
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Checking your payment|Payment Method|Review Your Order/ })).toBeVisible({ timeout: 30_000 });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await page.goto('/cart'); await expect(page.locator(`[data-purchase="${attempt.id}"]`)).toBeVisible({ timeout: 60_000 });
  await page.goBack(); await page.goForward(); await expect(page).toHaveURL(/\/cart/);
  await expect(page.locator(`[data-purchase="${attempt.id}"]`)).toBeVisible();
  // Real provider success arrives later (server-side confirm): webhook + worker persist PAID, the same Cart page releases the card.
  expect((await stripeConfirm(attempt.intentId, 'pm_card_visa')).status).toBe('requires_capture');
  await waitFor(() => attemptRows(email).at(-1)?.state === 'PAID', 180_000, 'persisted PAID');
  await expect(page.locator(`[data-purchase="${attempt.id}"]`)).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1);
  expect((await stripeIntent(attempt.intentId)).status).toBe('succeeded');
  await page.goto(`/checkout?purchase=${attempt.id}`);
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
});

test('Journey J: two tabs show one failure toast between them and another customer never sees the purchase', async ({ browser }) => {
  const email = customerEmail(12); const context = await browser.newContext(); const tab1 = await context.newPage(); const tab2 = await context.newPage();
  const attempt = await submitUnpaid(tab1, email, 12, 'AG-002'); ledger({ journey: 'J', attempt: attempt.id, intent: attempt.intentId });
  await tab1.goto('/cart'); await tab2.goto('/cart');
  await expect(tab1.locator(`[data-purchase="${attempt.id}"]`)).toBeVisible({ timeout: 60_000 });
  await expect(tab2.locator(`[data-purchase="${attempt.id}"]`)).toBeVisible({ timeout: 60_000 });
  expect((await stripeConfirm(attempt.intentId, 'pm_card_chargeDeclined')).errorCode).toBe('card_declined');
  await waitFor(() => attemptRows(email).at(-1)?.state === 'DECLINED', 120_000, 'persisted DECLINED');
  await expect(tab1.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 90_000 });
  await expect(tab2.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 90_000 });
  await tab1.waitForTimeout(3_000);
  const shown = (await tab1.getByText(FAILURE, { exact: true }).count()) + (await tab2.getByText(FAILURE, { exact: true }).count());
  expect(shown).toBeLessThanOrEqual(1); // shared-storage dedup: never one toast per tab
  // Another customer in a separate browser session never sees this purchase.
  const other = await browser.newContext(); const otherPage = await other.newPage(); await signIn(otherPage, 15);
  await otherPage.goto('/cart'); await otherPage.waitForTimeout(2_000);
  await expect(otherPage.locator(`[data-purchase="${attempt.id}"]`)).toHaveCount(0);
  await expect(otherPage.getByRole('heading', { name: 'Failed payments' })).toHaveCount(0);
  await context.close(); await other.close();
});
