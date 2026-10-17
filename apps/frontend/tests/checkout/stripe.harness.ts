import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { cart, confirmation, quote, shipping } from '../../src/features/checkout/fixtures';
import type { PaymentOutcome, PaymentState } from '../../src/features/checkout/types';

export const attemptId = '44444444-4444-4444-8444-444444444444';
export const paidConfirmation = { ...confirmation, paymentState: 'PAID' as const, card: { brand: 'visa', last4: '4242' } };
export async function harness(page: Page, options: { guest?: boolean; empty?: boolean; state?: PaymentState; unavailable?: boolean; unknown?: boolean; wrongOwner?: boolean; realClientSecret?: string } = {}) {
  page.on('pageerror', error => console.error('Intercepted Checkout runtime:', error.message));
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'checkout-demo@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
  const requests: { method: string; path: string; body?: unknown; key?: string }[] = [];
  if (!options.guest) await page.addInitScript(user => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)); }, user);
  if (!options.realClientSecret) {
    await page.addInitScript({ content: readFileSync('tests/checkout/stripe-sdk.fixture.js', 'utf8') });
    await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '// intercepted SDK fixture installed before application' }));
  }
  const empty = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
  let current = options.empty ? empty : structuredClone(cart); let state: PaymentState = 'AWAITING_INPUT';
  let purchase = false; let hold = false; let release: (() => void) | undefined; let selected = quote.deliveryMethods[0];
  let uncertain = options.unknown; let submittedAt: string | null = null;
  const outcome = (): PaymentOutcome => ({ attemptId, state, submittedAt, scope: "CART_CHECKOUT", providerStatus: state === 'PAID' ? 'succeeded' : 'requires_payment_method', failureCode: null,
    total: selected?.totals.total ?? cart.total, currency: 'USD', orderReference: purchase ? confirmation.orderReference : null, committed: purchase,
    cart: current, recoveryRemainder: null, recoveryActive: false, confirmation: purchase ? { ...paidConfirmation, total: selected?.totals.total ?? cart.total,
      deliveryMethod: selected?.id ?? 'STANDARD', shippingCost: selected?.price ?? '0.00' } : null });
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname; const method = req.method();
    if (!path.startsWith('/api/')) return route.continue();
    requests.push({ method, path, ...(method === 'POST' ? { body: req.postDataJSON(), key: req.headers()['idempotency-key'] } : {}) });
    const send = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path.startsWith('/api/auth/')) return options.guest ? send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } }, 401) :
      path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'intercepted-ui-test-token', user });
    if (path === '/api/cart') return send({ data: current });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === '/api/checkout') return send({ data: quote });
    if (path === '/api/checkout/payment-attempts' && method === 'GET') return send({ data: [] });
    if (path === '/api/checkout/payment-attempts') {
      if (options.unavailable) return send({ error: { code: 'PAYMENT_UNAVAILABLE', message: 'Secure payment setup unavailable.' } }, 503);
      selected = quote.deliveryMethods.find(method => method.id === req.postDataJSON().deliveryMethod);
      state = 'AWAITING_INPUT';
      return send({ data: { ...outcome(), clientSecret: options.realClientSecret ?? 'pi_intercepted_secret_fixture', replayed: false } }, 201);
    }
    if (path.startsWith('/api/checkout/payment-attempts/')) {
      if (options.wrongOwner) return send({ error: { code: 'PAYMENT_ATTEMPT_NOT_FOUND', message: 'Payment attempt not found.' } }, 404);
      if (path.endsWith('/submit')) { submittedAt = new Date().toISOString(); current = empty; return send({ data: outcome() }); }
      if (path.endsWith('/resume')) return send({ data: { ...outcome(), clientSecret: 'pi_intercepted_secret_fixture', request: { shipping, deliveryMethod: selected?.id ?? 'STANDARD', paymentMethod: 'CARD' }, items: cart.items.map(item => ({ name: item.product?.name ?? 'Product', quantity: item.quantity })) } });
      if (path.endsWith('/cancel')) { state = 'CANCELED'; return send({ data: outcome() }); }
      if (path.endsWith('/reconcile')) {
        if (hold) await new Promise<void>(resolve => { release = resolve; });
        if (uncertain) { uncertain = false; purchase = true; state = 'CAPTURE_PENDING'; current = empty; return route.abort('failed'); }
        state = options.state ?? 'PAID'; purchase = ['PAID', 'CAPTURE_PENDING', 'COMPENSATED', 'REFUNDED'].includes(state);
        if (state === 'PAID' || state === 'CAPTURE_PENDING') current = empty;
        return send({ data: outcome() }, state === 'PAID' || state === 'CANCELED' ? 200 : 202);
      }
      return send({ data: outcome() });
    }
    if (path.startsWith('/api/orders/')) return send({ data: { ...paidConfirmation, total: selected?.totals.total ?? cart.total, shippingCost: selected?.price ?? '0.00', deliveryMethod: selected?.id ?? 'STANDARD' } });
    if (path === '/api/orders') return send({ error: { code: 'PAYMENT_REQUIRED', message: 'Use payment checkout.' } }, 409);
    return send({ data: [], meta: { total: 0, page: 1, totalPages: 0 } });
  });
  return { requests, hold: () => { hold = true; }, release: () => { hold = false; release?.(); }, setState: (next: PaymentState) => { state = next; if (next === 'PAID') purchase = true; },
    confirms: () => page.evaluate(() => Reflect.get(window, '__stripeFixture').confirms as number) };
}
export async function fillShipping(page: Page) {
  for (const [field, value] of Object.entries(shipping)) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
}
export async function fillCard(page: Page) {
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
  await frame.getByLabel('Mock card number').fill('4242424242424242'); await frame.getByLabel('Mock expiry').fill('1230'); await frame.getByLabel('Mock security code').fill('123');
}
export async function review(page: Page) {
  await fillShipping(page); await page.getByRole('radio', { name: /Express Delivery/ }).check();
  await page.getByRole('button', { name: 'Continue to Payment' }).click(); await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
}
export async function capture(page: Page, file: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.screenshot({ path: file, fullPage: true });
}
