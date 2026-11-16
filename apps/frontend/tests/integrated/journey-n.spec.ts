import { expect, test } from '@playwright/test';
import { attemptRows, customerEmail, fillCard, ledger, signIn, sql, stripeIntent, waitFor } from './helpers';

const FAILURE = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
/** Reuses an EXISTING declined attempt/PaymentIntent (Try Again reuses it by contract): no new PaymentIntent is created. */
test('Journey N: declined purchase → Try Again → empty Payment Element → declined again → authoritative failure → Failed payments, never "Checkout saved"', async ({ page }) => {
  const n = Number(process.env.JOURNEY_CUSTOMER ?? 2); const email = customerEmail(n); await signIn(page, n);
  page.on('response', async r => { if (/payment-attempts/.test(r.url())) console.log('API', r.request().method(), r.url().replace(/^.*[/]api/, '/api').replace(/[0-9a-f-]{36}/g, 'ID'), r.status(), (await r.text().catch(() => '')).slice(0, 160)); });
  const before = attemptRows(email); const attempt = before.filter(row => row.state === 'DECLINED').at(-1)!; expect(attempt, 'a DECLINED attempt to reuse').toBeTruthy();
  ledger({ journey: 'N', attempt: attempt.id, intent: attempt.intentId, width: page.viewportSize()?.width });
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: /^Try Again/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible({ timeout: 60_000 });
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  await page.getByRole('heading', { name: 'Payment Method' }).scrollIntoViewIfNeeded();
  await expect(frame.getByLabel('Card number', { exact: true })).toHaveValue('', { timeout: 60_000 });
  await fillCard(page, '4000000000000002');
  await page.getByRole('button', { name: 'Review Order' }).click();
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: /Payment Failed|Payment needs a different card|Payment did not complete/ })).toBeVisible({ timeout: 120_000 });
  await waitFor(() => attemptRows(email).find(row => row.id === attempt.id)?.state === 'DECLINED', 60_000, 'persisted DECLINED');
  const intent = await stripeIntent(attempt.intentId); expect(intent.status).toBe('requires_payment_method'); expect(intent.amount_received).toBe(0);
  expect(sql(`SELECT count(DISTINCT "providerIntentId") FROM payment_attempts WHERE id = '${attempt.id}'`)).toBe('1');
  let toasts = 0; const watch = setInterval(() => { void page.getByText(FAILURE, { exact: true }).count().then(c => { toasts = Math.max(toasts, c); }).catch(() => undefined); }, 250);
  await page.getByRole('link', { name: 'Return to Cart' }).click();
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(12_000); // outlast the worker/webhook cadence: it must not flip back to a pending card
  await expect(page.locator(`[data-purchase="${attempt.id}"]`).getByText('Checkout saved')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  clearInterval(watch); expect(toasts).toBeLessThanOrEqual(1); console.log('MAX_FAILURE_TOASTS', toasts);

});
