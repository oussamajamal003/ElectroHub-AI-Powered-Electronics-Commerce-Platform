import { test, expect } from '@playwright/test';
import { harness, review, attemptId, capture, fillShipping, paidConfirmation } from './stripe.harness';
import { cart, quote } from '../../src/features/checkout/fixtures';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';
const empty = { ...cart, revision: 'e'.repeat(64), items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
for (const width of [1440, 390]) {
  test(`submitted A stays separate from Cart B at ${width}px and survives refresh`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await harness(page, { state: 'PROCESSING' });
    let submitted = false; let current = structuredClone(cart);
    const saved = { attemptId, scope: 'CART_CHECKOUT', state: 'PROCESSING', pending: true, unread: false,
      total: cart.total, currency: 'USD', orderReference: null, items: [{ name: 'Pending Product A', quantity: 2 }] };
    const outcome = { attemptId, state: 'PROCESSING', submittedAt: new Date().toISOString(), providerStatus: 'processing', failureCode: null,
      total: cart.total, currency: 'USD', orderReference: null, committed: false, cart: empty, confirmation: null, recoveryRemainder: null, recoveryActive: false };
    await page.route('**/api/cart', route => route.fulfill({ json: { data: current } }));
    await page.route('**/api/checkout/payment-attempts', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { data: submitted ? [saved] : [] } }) : route.fallback());
    await page.route(`**/api/checkout/payment-attempts/${attemptId}/submit`, route => {
      submitted = true; current = structuredClone(empty); return route.fulfill({ json: { data: outcome } });
    });
    await page.route(`**/api/checkout/payment-attempts/${attemptId}/reconcile`, route => route.fulfill({ json: { data: outcome } }));
    await page.route(`**/api/checkout/payment-attempts/${attemptId}`, route => route.fulfill({ json: { data: outcome } }));
    await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click();
    // Place Order settled unresolved → Stage 2 verification (Stage 1 only lasts while the request is in flight).
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await expect.poll(() => submitted).toBe(true);
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No active cart items' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toHaveCount(0);
    current = { ...structuredClone(cart), revision: 'b'.repeat(64), items: [{ ...structuredClone(cart.items[0]!), quantity: 1,
      product: { ...cart.items[0]!.product!, name: 'Product B', price: '199.00' }, lineTotal: '199.00' }], totalQuantity: 1, subtotal: '199.00', total: '199.00' };
    await page.reload();
    await expect(page.getByText('Product B', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
    await capture(page, `test-results/payment-lifecycle/cart-${width}.png`);
    await page.route('**/api/checkout', route => route.fulfill({ json: { data: { ...quote, cartRevision: current.revision, subtotal: current.subtotal,
      deliveryMethods: quote.deliveryMethods.map(method => ({ ...method, totals: { ...method.totals, subtotal: current.subtotal, total: '199.00' } })) } } }));
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Processing your order…' })).toHaveCount(0);
    await expect(page.getByText('Product B', { exact: true })).toBeVisible();
    expect(submitted).toBe(true);
  });
}
test('declined saved A is a Failed payments card with an explicit Try Again, independently of Cart B', async ({ page }) => {
  const api = await harness(page);
  const outcome = { attemptId, state: 'DECLINED', submittedAt: new Date().toISOString(), providerStatus: 'requires_payment_method', failureCode: 'PAYMENT_DECLINED',
    total: '199.00', currency: 'USD', orderReference: null, committed: false, cart, confirmation: null, recoveryRemainder: null, recoveryActive: false };
  // Scenario 1: a verified decline is a saved purchase in Cart with server-computed retry eligibility.
  await routeSavedPurchases(page, () => [savedPurchase({ state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true, retryAllowed: true,
    total: '199.00', items: [{ name: 'Product A', quantity: 1 }] })]);
  await page.route(`**/api/checkout/payment-attempts/${attemptId}/resume`, route => route.fulfill({ json: { data: { ...outcome,
    clientSecret: 'pi_saved_secret_fixture', request: { shipping: { recipient: 'Saved Person', line1: 'Saved Street', city: 'Saved City' }, deliveryMethod: 'STANDARD' },
    items: [{ name: 'Product A', quantity: 1 }] } } }));
  await page.goto(`/account/payment-status/${attemptId}`);
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 15000 });
  // Try Again opens Checkout's Payment step for this saved purchase; rendering the card never resumes anything.
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveAttribute('href', '/checkout?step=payment');
  await expect(page.getByText('Product A', { exact: true })).toBeVisible();
  expect(api.requests.filter(request => request.path.endsWith('/resume'))).toHaveLength(0);
  await capture(page, 'test-results/payment-lifecycle/retry.png');
});

test('simultaneous tabs: A confirms in its saved purchase while B keeps its own secure entry', async ({ page, context }) => {
  await harness(page);
  const statusTab = await context.newPage(); await statusTab.clock.install(); await harness(statusTab);
  let paid = false;
  // Scenario 1: tab A follows its submitted purchase through the shared saved-purchase list in Cart.
  await routeSavedPurchases(statusTab, () => [savedPurchase(paid
    ? { state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: paidConfirmation.orderReference }
    : { state: 'PROCESSING', classification: 'PROCESSING' })]);
  await statusTab.goto(`/account/payment-status/${attemptId}`);
  await expect(statusTab).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(statusTab.locator(`[data-purchase="${attemptId}"]`).getByText('Processing')).toBeVisible();
  const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await page.route('**/api/checkout/payment-attempts', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { data: [] } }) : route.fulfill({ json: { data: { attemptId: idB, state: 'AWAITING_INPUT',
      providerStatus: 'requires_payment_method', failureCode: null, total: cart.total, currency: 'USD', committed: false,
      orderReference: null, confirmation: null, recoveryActive: false, recoveryRemainder: null, cart,
      clientSecret: 'pi_B_secret_intercepted', replayed: false } } }));
  await page.goto('/checkout'); await fillShipping(page);
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  paid = true; await statusTab.clock.runFor(15_001);
  await expect(statusTab.locator(`[data-purchase="${attemptId}"][data-outcome="success"]`).getByRole('status')).toHaveText('Payment confirmed');
  await expect(page.getByRole('heading', { name: 'Payment Method', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
  const secrets = await page.evaluate(() => Reflect.get(window, '__stripeFixture').clientSecrets as string[]);
  expect(secrets.length).toBeGreaterThan(0); expect(secrets.every(secret => secret === 'pi_B_secret_intercepted')).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').confirms)).toBe(0);
  await statusTab.close();
});
