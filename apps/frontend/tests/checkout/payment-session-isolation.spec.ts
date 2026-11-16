import { expect, test } from '@playwright/test';
import { harness, fillShipping } from './stripe.harness';
import { cart, quote, shipping, confirmation } from '../../src/features/checkout/fixtures';
import type { CartData } from '../../src/features/cart/types';
import type { PaymentOutcome } from '../../src/features/checkout/types';

const userId = '11111111-1111-4111-8111-111111111111';
const attemptA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attemptB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const first = cart.items[0];
if (!first?.product) throw new Error('Missing Product fixture.');
const cartB: CartData = { ...cart, revision: 'b'.repeat(64), subtotal: '42.00', total: '42.00', totalQuantity: 1,
  items: [{ ...first, productId: attemptB, quantity: 1, lineTotal: '42.00', product: { ...first.product, name: 'Item B', slug: 'item-b', price: '42.00' } }] };
const pendingA: PaymentOutcome = { attemptId: attemptA, intentId: 'pi_A', cartIdentity: 'owned-cart', cartRevision: cart.revision,
  state: 'PROCESSING', providerStatus: 'processing', failureCode: null, total: cart.total, currency: 'USD', orderReference: null,
  committed: false, cart, confirmation: null, recoveryRemainder: null, recoveryActive: false };

for (const step of ['shipping', 'payment'] as const) {
  test(`intercepted browser: pending A cannot confirm or overwrite B in ${step}; B survives refresh/history`, async ({ page }) => {
    await harness(page);
    let current = cart;
    let releaseA!: () => void;
    const delayedA = new Promise<void>(resolve => { releaseA = resolve; });
    const setupRequests: { revision: string; key: string }[] = [];
    let statusStarted = false;
    await page.addInitScript(({ userId, attemptA, shipping, revision }) => {
      if (sessionStorage.getItem(`electrohub:checkout:v1:${userId}`)) return;
      sessionStorage.setItem(`electrohub:checkout:v1:${userId}`, JSON.stringify({ version: 1, userId, draft: {
        shipping, shippingComplete: true, deliveryComplete: true, paymentComplete: true, reviewReached: true, deliveryMethod: 'STANDARD',
        attempt: { key: attemptA, paymentAttemptId: attemptA, intentId: 'pi_A', status: 'unknown',
          request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: revision } },
      } }));
    }, { userId, attemptA, shipping, revision: cart.revision });
    await page.route('**/api/cart', route => route.fulfill({ json: { data: current } }));
    await page.route('**/api/cart/items', route => { current = cartB; return route.fulfill({ json: { data: current } }); });
    await page.route('**/api/checkout', route => route.fulfill({ json: { data: { ...quote, cartRevision: current.revision,
      subtotal: current.subtotal, deliveryMethods: quote.deliveryMethods.map(method => ({ ...method, totals: {
        ...method.totals, subtotal: current.subtotal, total: current.revision === cartB.revision
          ? method.id === 'STANDARD' ? '42.00' : method.id === 'EXPRESS' ? '51.99' : '61.99' : method.totals.total,
      } })) } } }));
    await page.route('**/api/checkout/payment-attempts', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: [] } });
      const body = route.request().postDataJSON() as { expectedRevision: string };
      const key = route.request().headers()['idempotency-key'];
      if (!key) throw new Error('Missing idempotency key.');
      setupRequests.push({ revision: body.expectedRevision, key });
      return route.fulfill({ json: { data: { ...pendingA, attemptId: attemptB, intentId: 'pi_B', cartRevision: cartB.revision,
        state: 'AWAITING_INPUT', providerStatus: 'requires_payment_method', total: cartB.total, cart: current,
        clientSecret: 'pi_B_secret_intercepted', replayed: setupRequests.length > 1 } } });
    });
    await page.route(`**/api/checkout/payment-attempts/${attemptA}/reconcile`, route => route.fulfill({ json: { data: pendingA } }));
    await page.route(`**/api/checkout/payment-attempts/${attemptA}`, async route => {
      statusStarted = true; await delayedA;
      await route.fulfill({ json: { data: { ...pendingA, state: 'PAID', committed: true,
        cart: { ...cart, items: [], totalQuantity: 0 }, confirmation: { ...confirmation, paymentState: 'PAID' } } } }).catch(() => undefined);
    });
    const cartLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cart');
    await page.goto('/checkout?step=payment');
    await cartLoaded;
    await expect.poll(() => statusStarted).toBe(true);
    await page.locator('header').getByRole('link', { name: /^Cart,/ }).click();
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
    expect(await page.evaluate(userId => JSON.parse(sessionStorage.getItem(`electrohub:checkout:v1:${userId}`)!).draft.attempt, userId)).toBeNull();
    await page.evaluate(async productId => { await fetch('/api/cart/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity: 1 }) }); }, attemptB);
    await page.reload();
    await expect(page.getByText('Item B', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    if (step === 'payment') {
      await fillShipping(page);
      await page.getByRole('button', { name: 'Continue to Payment' }).click();
      await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    }
    releaseA();
    await expect(page).toHaveURL(/\/checkout(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Checking your payment|Finalizing your order/ })).toHaveCount(0);
    await expect(page.getByText('Item B', { exact: true })).toBeVisible();
    await page.reload();
    if (step === 'payment') await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    else await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    await expect(page.getByText('Item B', { exact: true })).toBeVisible();
    await page.goBack();
    if (step === 'payment') await expect(page.getByRole('radio', { name: /Standard Delivery/ })).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
    await page.goForward();
    if (step === 'payment') await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    else await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Checking your payment|Finalizing your order/ })).toHaveCount(0);
    expect(setupRequests.every(request => request.revision === cartB.revision && request.key !== attemptA)).toBe(true);
    if (step === 'payment') {
      const secrets = await page.evaluate(() => Reflect.get(window, '__stripeFixture').clientSecrets as string[]);
      expect(secrets.length).toBeGreaterThan(0); expect(secrets.every(secret => secret === 'pi_B_secret_intercepted')).toBe(true);
    }
    expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').confirms)).toBe(0);
  });
}
