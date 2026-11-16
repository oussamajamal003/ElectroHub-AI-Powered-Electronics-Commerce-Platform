import { expect, test } from '@playwright/test';
import { harness, fillShipping, attemptId } from './stripe.harness';
import { cart, quote, confirmation } from '../../src/features/checkout/fixtures';

// React/browser execution only. All backend and hosted SDK traffic is intercepted;
// backend state transitions are separately tested through actual PaymentService.
for (const terminal of ['CANCELED', 'PAID'] as const) {
  test(`old ${terminal} blocker cannot hijack current checkout; exact setup resumes automatically`, async ({ page }) => {
    const api = await harness(page);
    const oldId = '99999999-9999-4999-8999-999999999999';
    const keys: string[] = [];
    await page.route('**/api/checkout/payment-attempts', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { data: [] } });
      keys.push(route.request().headers()['idempotency-key']);
      expect(route.request().postDataJSON().expectedRevision).toBe(cart.revision);
      if (keys.length === 1) return route.fulfill({ status: 409, json: { error: {
        code: 'PAYMENT_RECOVERY_PENDING', message: 'Existing payment unresolved',
        recovery: { attemptId: oldId, state: 'CANCEL_PENDING', workState: 'LEASED', lease: 'active' },
      } } });
      return route.fulfill({ json: { data: { attemptId, cartIdentity: 'cart', cartRevision: cart.revision,
        intentId: 'pi_current', state: 'AWAITING_INPUT', providerStatus: 'requires_payment_method', failureCode: null,
        total: quote.deliveryMethods[0]!.totals.total, currency: 'USD', orderReference: null, committed: false,
        cart, confirmation: null, recoveryRemainder: null, recoveryActive: false,
        clientSecret: 'pi_current_secret_fixture', replayed: true } } });
    });
    let reads = 0;
    await page.route(`**/api/checkout/payment-attempts/${oldId}`, route => {
      reads++;
      return route.fulfill({ json: { data: { attemptId: oldId, state: terminal, recoveryActive: false,
        cart: { ...cart, items: [], canCheckout: false }, committed: terminal === 'PAID',
        confirmation: terminal === 'PAID' ? { ...confirmation, paymentState: 'PAID' } : null } } });
    });
    await page.goto('/checkout'); await fillShipping(page);
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    await expect(page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]').getByLabel('Mock card number')).toBeVisible();
    expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]); expect(reads).toBe(1);
    expect(await api.confirms()).toBe(0); expect(page.url()).toContain('/checkout?step=payment');
    await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry payment setup' })).toHaveCount(0);
    await page.screenshot({ path: `test-results/checkout/blocker-${terminal}-ready.png`, fullPage: true });
  });
}

test('authorized blocker survives refresh; observations stop within the bounded window without a second setup', async ({ page }) => {
  const api = await harness(page);
  const oldId = '99999999-9999-4999-8999-999999999999'; let setups = 0; let reads = 0;
  await page.route('**/api/checkout/payment-attempts', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: [] } });
    setups++;
    return route.fulfill({ status: 409, json: { error: { code: 'PAYMENT_RECOVERY_PENDING', message: 'Existing authorization',
      recovery: { attemptId: oldId, state: 'AUTHORIZED', workState: 'READY', lease: 'none' } } } });
  });
  await page.route(`**/api/checkout/payment-attempts/${oldId}`, route => {
    reads++; return route.fulfill({ json: { data: { attemptId: oldId, state: 'AUTHORIZED', recoveryActive: false } } });
  });
  await page.goto('/checkout'); await fillShipping(page);
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('alert')).toContainText('Checking its status');
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Checking its status');
  expect(setups).toBe(2); // One explicit mount per navigation, same stored idempotency key.
  await page.clock.install(); await page.clock.fastForward(123000);
  await expect(page.getByRole('alert')).toContainText('Automatic checks have paused');
  const stopped = reads; await page.clock.fastForward(10000); expect(reads).toBe(stopped);
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeDisabled();
  expect(setups).toBe(2); expect(await api.confirms()).toBe(0);
});
