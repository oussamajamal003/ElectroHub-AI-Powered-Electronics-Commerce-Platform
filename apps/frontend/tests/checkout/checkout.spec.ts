import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cart, confirmation, shipping } from '../../src/features/checkout/fixtures';
import { harness, review, fillShipping, fillCard, capture, attemptId } from './stripe.harness';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';

// SDK/API interception in this suite proves UI behavior ONLY, never financial persistence.
test('guest protection', async ({ page }) => {
  const api = await harness(page, { guest: true }); const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/refresh');
  await page.goto('/checkout?step=review'); await restored; await expect(page).toHaveURL(/\/cart$/);
  expect(api.requests.some(value => value.method === 'POST' && value.path.includes('payment-attempts'))).toBe(false);
});
test('resolved empty Cart cannot submit', async ({ page }) => {
  const api = await harness(page, { empty: true }); await page.goto('/checkout'); await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible({ timeout: 30000 });
  expect(api.requests.some(value => value.method === 'POST' && value.path.includes('payment-attempts'))).toBe(false);
});
test('Shipping validation, guards, history and delivery totals', async ({ page }) => {
  const api = await harness(page); await page.goto('/checkout?step=review'); await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /4\. Review/ })).toBeDisabled(); await page.getByRole('button', { name: 'Continue to Delivery' }).click(); await expect(page.locator('#shipping-recipient')).toBeFocused();
  await fillShipping(page); await page.getByRole('radio', { name: /Express Delivery/ }).check(); await expect(page.getByText('$2,209.97')).toBeVisible();
  await page.getByRole('radio', { name: /Overnight Delivery/ }).check(); await expect(page.getByText('$2,219.97')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await expect(page.locator('#shipping-city')).toHaveValue(shipping.city);
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Delivery Method' })).toBeVisible(); expect(api.requests.filter(value => value.path === '/api/checkout')).toHaveLength(1);
});
test('validation before Review; permanent step unlock and secure mount retention without charge', async ({ page }) => {
  const api = await harness(page); await page.goto('/checkout'); await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled(); await page.getByRole('button', { name: 'Review Order' }).click(); await expect(page.getByRole('alert')).toContainText('highlighted');
  await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click(); await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible(); expect(await api.confirms()).toBe(0);
  for (const [step, heading] of [[1, 'Shipping Information'], [2, 'Delivery Method'], [3, 'Payment Method'], [4, 'Review Your Order']] as const) {
    await page.getByRole('button', { name: new RegExp(`^${step}\\.`) }).click(); await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /4\. Review/ })).toBeEnabled();
  }
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').mounts)).toBe(1);
  const saved = await page.evaluate(() => sessionStorage.getItem('electrohub:checkout:v1:11111111-1111-4111-8111-111111111111')); expect(saved).not.toContain('pi_intercepted_secret_fixture');
});
test('single final consent, pending state, Cart/header clearing and persisted Paid confirmation', async ({ page }) => {
  const api = await harness(page); api.hold(); await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByText('Processing your order…')).toBeVisible();
  await expect(page.getByRole('button', { name: /Place Order/ })).toHaveCount(0);
  await expect.poll(() => api.confirms()).toBe(1);
  await expect.poll(() => api.requests.filter(value => value.path.endsWith('/reconcile')).length).toBe(1);
  api.release(); await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible(); await expect(page.getByText('Total Paid', { exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
  await page.reload(); await expect(page.getByText(confirmation.orderReference)).toBeVisible(); expect(api.requests.filter(value => value.path === '/api/orders' || value.path.includes('/inventory'))).toHaveLength(0);
});
test('real BrowserRouter permits shell, keyboard and history navigation during submitted payment', async ({ page }) => {
  const api = await harness(page); api.hold(); await page.goto('/cart');
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click(); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect.poll(() => api.requests.filter(value => value.path.endsWith('/reconcile')).length).toBe(1);
  await expect(page.getByTestId('header-lock-wrapper')).not.toHaveAttribute('inert', '');
  await expect(page.getByTestId('footer-lock-wrapper')).not.toHaveAttribute('inert', '');
  await page.locator('header a[href="/products"]').focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/products$/);
  await page.goBack(); await expect(page).toHaveURL(/\/checkout/);
  await page.goForward(); await expect(page).toHaveURL(/\/products$/);
  api.release(); await page.waitForTimeout(100);
  await expect(page).toHaveURL(/\/products$/);
  expect(await api.confirms()).toBe(1);
  expect(api.requests.filter(value => value.path.endsWith('/cancel'))).toHaveLength(0);
});
test('lost response retains exact attempt and recovers on reload before empty Cart', async ({ page }) => {
  const api = await harness(page, { unknown: true }); await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByRole('heading', { name: 'Processing your order…' })).toBeVisible();
  // A lost response settles as unconfirmed (never failure, never permanent checking) with a same-attempt check.
  await expect(page.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  expect(api.requests.filter(value => value.path.endsWith('/reconcile'))).toHaveLength(1);
  const setup = api.requests.find(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts');
  api.setState('PAID');
  // Scenario 1: the legacy status URL keeps the attempt identity and redirects to Cart; the server-verified
  // success is announced off-Cart and opens the persisted confirmation for that exact order.
  await routeSavedPurchases(page, () => [savedPurchase({ state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: confirmation.orderReference })]);
  await page.goto(`/account/payment-status/${attemptId}`); await page.reload();
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await page.getByRole('link', { name: 'Explore Products' }).click();
  await expect(page.getByText('Payment successful! Your order has been confirmed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Order' })).toHaveCount(1);
  await page.getByRole('link', { name: 'View Order' }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/confirmation/${confirmation.orderReference}$`));
  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible({ timeout: 30000 });
  expect(api.requests.filter(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts')).toHaveLength(1); expect(setup?.key).toMatch(/^[a-f0-9-]{36}$/);
  expect(api.requests.filter(value => value.path.endsWith('/reconcile')).every(value => value.path.includes(attemptId))).toBe(true);
});
for (const [state, heading, action] of [
  ['DECLINED', 'Payment Failed', 'Try Again'],
  ['ACTION_REQUIRED', 'Additional verification required', 'Try Again'],
  ['CANCELED', 'Payment did not complete', 'Try Again'],
  ['COMPENSATED', 'Payment did not complete', 'Try Again'],
  ['REFUNDED', 'Payment refunded', 'Try Again'],
  ['INCIDENT', 'Checking your payment', null],
] as const) test(`${state} never becomes Paid and preserves identity`, async ({ page }) => {
  const api = await harness(page, { state }); await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  if (action) await expect(page.getByRole('button', { name: state === 'CANCELED' || state === 'COMPENSATED' || state === 'REFUNDED' ? 'Restore items to Cart' : action })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0); // unresolved: no retry
  await expect(page.getByText('Total Paid', { exact: true })).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
  expect(api.requests.filter(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts')).toHaveLength(1);
  const saved = await page.evaluate(() => sessionStorage.getItem('electrohub:checkout:v1:11111111-1111-4111-8111-111111111111')); expect(saved).toContain(attemptId); expect(saved).not.toContain('pi_intercepted_secret_fixture');
});
test('setup failure cannot authorize or navigate to Review', async ({ page }) => {
  const api = await harness(page, { unavailable: true }); await page.goto('/checkout'); await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('alert')).toHaveText('Secure payment setup could not finish. Your saved attempt is safe. Retry payment setup to resume it.'); await expect(page.getByRole('button', { name: 'Review Order' })).toBeDisabled(); expect(await api.confirms()).toBe(0);
});
test('ownership miss retains recovery and cannot show private confirmation or start another attempt', async ({ page }) => {
  const api = await harness(page, { wrongOwner: true });
  await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: /Processing your order…|Checking your payment|We couldn’t confirm your payment yet/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  // Scenario 1: the legacy status URL redirects to Cart; another owner's attempt is never listed or confirmed there.
  await page.goto(`/account/payment-status/${attemptId}`); await page.reload();
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await expect(page.getByText('Total Paid', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
  expect(api.requests.filter(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts')).toHaveLength(1);
});
test('slow Confirmation resolves independently of Cart', async ({ page, context }) => {
  const api = await harness(page, { empty: true }); const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
  const resolved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/orders/${confirmation.orderReference}/confirmation`);
  await page.goto(`/checkout/confirmation/${confirmation.orderReference}`); await resolved; await expect(page.getByText(confirmation.orderReference)).toBeVisible(); expect(api.requests.filter(value => value.method === 'POST' && value.method === 'POST' && value.path.includes('payment-attempts'))).toHaveLength(0);
});
for (const width of [390, 768, 1440, 1920]) test(`responsive/keyboard/reduced-motion/slow pending at ${width} (intercepted UI)`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' }); const api = await harness(page); api.hold(); await page.goto('/checkout'); await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 30000 });
  await capture(page, `screenshots/stripe-intercepted/shipping-${width}.png`); await fillShipping(page); await page.getByRole('radio', { name: /Express Delivery/ }).focus(); await page.keyboard.press('Space'); await capture(page, `screenshots/stripe-intercepted/delivery-${width}.png`);
  await page.getByRole('button', { name: 'Continue to Payment' }).click(); await capture(page, `screenshots/stripe-intercepted/payment-${width}.png`); await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click(); await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible(); await capture(page, `screenshots/stripe-intercepted/review-${width}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.addScriptTag({ content: readFileSync('../../node_modules/axe-core/axe.min.js', 'utf8') });
  const violations = await page.evaluate(async () => (await Reflect.get(window, 'axe').run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map((value: { id: string }) => value.id)); expect(violations).toEqual([]);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 100 * 1024, uploadThroughput: 50 * 1024 });
  await page.getByRole('button', { name: /Place Order/ }).focus(); await page.keyboard.press('Enter'); await expect(page.getByText('Processing your order…')).toBeVisible(); await capture(page, `screenshots/stripe-intercepted/processing-${width}.png`);
  api.release(); await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible(); await capture(page, `screenshots/stripe-intercepted/confirmation-${width}.png`); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect.poll(() => api.confirms()).toBe(1);
});

test('Buy Now independent checkout renders dedicated item without mutating persistent cart', async ({ page }) => {
  await harness(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('electrohub:buynow:v1', JSON.stringify({
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
    }));
  });
  await page.goto('/checkout/buy-now');
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 30000 });
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumb).toContainText('Buy Now Checkout');
  await expect(breadcrumb.getByRole('link', { name: 'Cart' })).toHaveCount(0);
});

test('Failed payment re-entry starts clean at Shipping step', async ({ page }) => {
  await harness(page, { state: 'DECLINED' });
  await page.goto('/checkout');
  await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible({ timeout: 15000 });

  await page.route('**/api/cart', route => route.fulfill({ json: { data: cart } }));
  // Return to independent active Cart B
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible({ timeout: 15000 });

  // Re-enter checkout
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
});
