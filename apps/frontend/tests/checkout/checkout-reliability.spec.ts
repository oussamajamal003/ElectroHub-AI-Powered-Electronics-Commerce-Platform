import { expect, test } from '@playwright/test';
import { attemptId, harness, review } from './stripe.harness';
import { cart, quote } from '../../src/features/checkout/fixtures';

// Owned frontend only; every backend and Stripe SDK request is intercepted.
for (const scope of ['CART_CHECKOUT', 'BUY_NOW'] as const) {
  for (const state of ['DECLINED', 'PAID', 'ACTION_REQUIRED'] as const) {
    test(`${scope}: transient quote recovery → usable fields → ${state}`, async ({ page }) => {
      const api = await harness(page, { state });
      let reconciles = 0;
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/reconcile')) reconciles++;
      });
      if (scope === 'BUY_NOW') await page.addInitScript(selection => {
        sessionStorage.setItem('electrohub:buynow:v1', JSON.stringify(selection));
      }, { productId: cart.items[0]!.productId, quantity: 2 });
      let quoteReads = 0;
      await page.route(/\/api\/checkout(?:\?.*)?$/, route => {
        quoteReads++;
        if (quoteReads <= 2) return route.fulfill({ status: 503, json: { error: { message: 'Transient unavailable quote' } } });
        return route.fulfill({ json: { data: scope === 'BUY_NOW' ? { ...quote, scope, summary: cart } : quote } });
      });
      if (state === 'DECLINED') {
        const base = { attemptId, total: cart.total, currency: 'USD', committed: false, orderReference: null, cart,
          confirmation: null, recoveryRemainder: null };
        await page.route('**/api/checkout/payment-attempts/*/reconcile', route => route.fulfill({ json: { data: {
          ...base, state: 'PROCESSING', providerStatus: 'processing', recoveryActive: true, failureCode: null,
        } } }));
        await page.route(`**/api/checkout/payment-attempts/${attemptId}`, route => route.fulfill({ json: { data: {
          ...base, state: 'DECLINED', providerStatus: 'requires_payment_method', recoveryActive: false, failureCode: 'PAYMENT_DECLINED',
        } } }));
      }
      await page.goto(scope === 'BUY_NOW' ? '/checkout/buy-now' : '/checkout');
      await review(page);
      await expect(page.getByRole('button', { name: /Place Order/ })).toBeEnabled();
      await page.getByRole('button', { name: /Place Order/ }).click();
      await expect(page.getByRole('heading', { name: state === 'PAID' ? 'Order Confirmed!' : state === 'DECLINED' ? 'Payment Failed' : 'Additional verification required' })).toBeVisible();
      expect(await api.confirms()).toBe(1);
      expect(reconciles).toBe(1);
      await expect(page.getByText('Payment needs your attention', { exact: true })).toHaveCount(0);
      expect(quoteReads).toBe(3);
      await page.screenshot({ path: `test-results/checkout/reliability-${scope}-${state}.png`, fullPage: true });
      if (state === 'ACTION_REQUIRED') {
        const before = api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts').map(request => request.key);
        await page.getByRole('button', { name: 'Try Again' }).click();
        await expect(page).toHaveURL(/[?]step=payment$/);
        await expect(page.getByText('Retrying payment for this purchase')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
        const after = api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts').map(request => request.key);
        expect(after).toEqual(before); expect(await api.confirms()).toBe(1);
      }
    });
  }
}
