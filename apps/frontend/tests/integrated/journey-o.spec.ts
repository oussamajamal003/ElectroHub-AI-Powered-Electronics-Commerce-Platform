import { expect, test } from '@playwright/test';
import { attemptRows, customerEmail, fillCard, ledger, signIn, sql, stripeIntent, waitFor } from './helpers';

/** Reuses an EXISTING declined attempt/PaymentIntent (no new PaymentIntent). */
test('Journey O: Try Again → card entry survives refresh and navigation → different card → Review → Place Order → PAID', async ({ page }) => {
  const n = Number(process.env.JOURNEY_CUSTOMER ?? 12); const email = customerEmail(n); await signIn(page, n);
  const attempt = attemptRows(email).filter(row => row.state === 'DECLINED').at(-1)!; expect(attempt, 'a DECLINED attempt to reuse').toBeTruthy();
  ledger({ journey: 'O', attempt: attempt.id, intent: attempt.intentId, width: page.viewportSize()?.width });
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  const emptyCardEntry = async () => {
    await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('heading', { name: 'Payment Method' }).scrollIntoViewIfNeeded();
    await expect(frame.getByLabel('Card number', { exact: true })).toHaveValue('', { timeout: 45_000 }).catch(async error => { console.log('DIAG url', page.url(), 'iframes', JSON.stringify(await page.locator('iframe').evaluateAll(list => list.map(el => (el.getAttribute('src') || '').slice(0, 90) + '|' + el.title))), 'alerts', JSON.stringify(await page.getByRole('alert').allInnerTexts()), 'status', JSON.stringify(await page.getByRole('status').allInnerTexts())); throw error; });
    await expect(page.getByRole('heading', { name: /Processing|Order Confirmed|Payment Failed/ })).toHaveCount(0);
  };
  await page.goto('/cart');
  await page.getByRole('link', { name: /^Try Again/ }).first().click();
  await emptyCardEntry();
  await page.reload(); await emptyCardEntry();                       // refresh on the Payment step
  await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).first().click(); await emptyCardEntry(); // leave and come back
  expect(attemptRows(email).find(row => row.id === attempt.id)?.state).not.toBe('PAID');   // nothing was submitted automatically
  await fillCard(page, '4242424242424242');
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//, { timeout: 120_000 });
  await waitFor(() => attemptRows(email).find(row => row.id === attempt.id)?.state === 'PAID', 60_000, 'persisted PAID');
  const intent = await stripeIntent(attempt.intentId); expect(intent.status).toBe('succeeded'); expect(intent.amount_received).toBe(intent.amount);
  expect(sql(`SELECT count(DISTINCT "providerIntentId") FROM payment_attempts WHERE id = '${attempt.id}'`)).toBe('1');
});
