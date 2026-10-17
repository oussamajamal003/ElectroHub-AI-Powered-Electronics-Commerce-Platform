import { test, expect, type Page } from '@playwright/test';
import { harness, attemptId, paidConfirmation, review } from './stripe.harness';
import { cart } from '../../src/features/checkout/fixtures';

// Real browser/app, intercepted provider/API. Never a claim about the customer's real $719 purchase.
const shots = '../../.cache/payment-lifecycle-followup/shots';
const product = 'Apple iPad Air 11 M2 Wi-Fi 256GB — Space Gray';
const otherId = '66666666-6666-4666-8666-666666666666';
async function world(page: Page, submitted = true, emptyCart = true, initial = 'PROCESSING') {
  const api = await harness(page);
  let state = initial; let published = submitted; let reads = 0; let checks = 0; let statusDown = false;
  let posts = 0;
  const empty = { ...cart, items: [], totalQuantity: 0, total: '0.00', subtotal: '0.00', canCheckout: false };
  const sameProductB = { ...cart, revision: 'b'.repeat(64), total: '719.00', subtotal: '719.00', totalQuantity: 1,
    items: [{ ...cart.items[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 1, lineTotal: '719.00',
      product: { ...cart.items[0].product!, name: product, price: '719.00' } }] };
  let active = submitted ? emptyCart ? empty : sameProductB : cart;
  const row = (id = attemptId) => ({ attemptId: id, scope: 'CART_CHECKOUT', state: id === otherId ? 'PROCESSING' : state,
    classification: id === otherId ? 'PROCESSING' : state === 'PAID' ? 'SUCCEEDED' : state === 'DECLINED' ? 'DECLINED' : 'PROCESSING',
    pending: id === otherId || !['PAID', 'DECLINED'].includes(state), unread: id !== otherId && ['PAID', 'DECLINED'].includes(state),
    retryAllowed: id !== otherId && state === 'DECLINED', orderReference: state === 'PAID' && id !== otherId ? paidConfirmation.orderReference : null,
    submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), total: '719.00', currency: 'USD',
    items: [{ name: product, quantity: 1 }] });
  const outcome = () => ({ ...row(), intentId: 'pi_intercepted', committed: state === 'PAID',
    confirmation: state === 'PAID' ? paidConfirmation : null, recoveryActive: false, cart: active });
  let second = false;
  await page.route('**/api/cart', route => route.fulfill({ json: { data: active } }));
  await page.route('**/api/checkout/payment-attempts**', route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    if (method === 'POST') posts++;
    if (path.endsWith('/payment-attempts') && method === 'GET') { reads++; return route.fulfill({ json: { data: published ? [row(), ...(second ? [row(otherId)] : [])] : [] } }); }
    if (path.endsWith('/submit')) { active = emptyCart ? empty : sameProductB; return route.fulfill({ json: { data: { ...outcome(), state: 'AWAITING_INPUT', classification: 'PROCESSING' } } }); }
    if (path.endsWith('/reconcile')) { checks++; return route.fulfill({ json: { data: outcome() } }); }
    if (path.endsWith('/read')) return route.fulfill({ json: { data: {} } });
    if (path === `/api/checkout/payment-attempts/${attemptId}` && method === 'GET') return statusDown
      ? route.fulfill({ status: 503, json: { error: { code: 'PAYMENT_UNAVAILABLE', message: 'Unavailable' } } })
      : route.fulfill({ json: { data: outcome() } });
    return route.fallback();
  });
  await page.route('**/api/orders**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/orders'
    ? { data: state === 'PAID' ? [paidConfirmation] : [], meta: { page: 1, pageSize: 10, total: state === 'PAID' ? 1 : 0, totalPages: 1 } }
    : { data: paidConfirmation } }));
  return { api, reads: () => reads, checks: () => checks, posts: () => posts,
    publish: () => { published = true; }, finish: (next: string) => { state = next; }, down: (value: boolean) => { statusDown = value; }, multiple: () => { second = true; } };
}
for (const width of [390, 1366]) test.describe(`${width}px`, () => {
  test.use({ viewport: { width, height: 900 } });
  test('original processing history preserves A through refresh and forward while a new Checkout B stays independent', async ({ page }) => {
    const w = await world(page, false, false);
    await page.goto('/checkout'); await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect.poll(w.checks).toBe(1);
    await page.getByRole('link', { name: /^Cart, / }).click();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Checking your payment', exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`purchase=${attemptId}`));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Checking your payment', exact: true })).toBeVisible();
    await page.screenshot({ path: `${shots}/history-restored-processing-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.goForward();
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByRole('heading', { name: product, exact: true })).toBeVisible();
    await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText('$719.00');
    await page.getByRole('button', { name: 'Proceed to Checkout', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Shipping Information', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Checking your payment', exact: true })).toHaveCount(0);
    expect(await w.api.confirms()).toBe(0); expect(w.checks()).toBe(1);
  });
  // Task 03.6 regression matrix 2-4: Processing survives Cart navigation, refresh and browser Back; navigation never cancels or releases it.
  test('an accepted purchase stays Processing on Cart through navigation, refresh and Back; nothing is cancelled or released', async ({ page }) => {
    const w = await world(page, false, false);
    const posts: string[] = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
    await page.goto('/checkout'); await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect.poll(w.checks).toBe(1); w.publish();
    await page.getByRole('link', { name: /^Cart, / }).click();
    const card = page.locator(`[data-purchase="${attemptId}"]`);
    await expect(card.getByText('Processing', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Check payment status' })).toBeVisible();
    await page.reload();
    await expect(card.getByText('Processing', { exact: true })).toBeVisible();
    await page.goBack();
    await page.goForward();
    await expect(card.getByText('Processing', { exact: true })).toBeVisible();
    for (const removed of ['Not completed', 'Incomplete purchases', 'Checkout saved', 'Continue to payment', 'Restore items']) await expect(page.getByText(removed)).toHaveCount(0);
    expect(posts.filter(path => /\/(cancel|release|release-unconfirmed|restore|dismiss)$/.test(path))).toEqual([]);
    expect(await w.api.confirms()).toBe(0);
  });
  test('original checkout history restores the submitted purchase after a failure toast cleared its discovery pointer', async ({ page }) => {
    await page.clock.install(); const w = await world(page, false, true);
    await page.goto('/checkout'); await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect.poll(w.checks).toBe(1);
    await page.getByRole('link', { name: /^Cart, / }).click();
    w.publish(); w.finish('DECLINED'); await page.clock.fastForward(16000);
    await expect(page.getByRole('heading', { name: 'Failed payments', exact: true })).toBeVisible();
    await expect(page.getByText('Payment was not completed. Your saved purchase details are kept in your Cart history.', { exact: true })).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Payment Failed', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
    await page.screenshot({ path: `${shots}/history-restored-failure-${width}.png`, fullPage: true, animations: 'disabled' });
    expect(await w.api.confirms()).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Payment Failed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect(page).toHaveURL(/checkout\?step=payment/);
    const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
    await expect(frame.getByLabel('Mock card number')).toHaveValue('');
    expect(await w.api.confirms()).toBe(0); expect(w.checks()).toBe(1);
  });
  test('submitted card-entry purchases use Processing without automatically confirming payment', async ({ page }) => {
    await page.clock.install();
    const w = await world(page, true, true, 'AWAITING_INPUT');
    await page.goto('/cart');
    const card = page.locator(`article[data-purchase="${attemptId}"]`);
    await expect(card.getByText('Payment details needed', { exact: true })).toHaveCount(0);
    await expect(card.getByText('Processing', { exact: true })).toBeVisible();
    await expect(card.locator('[class*="purchaseProgress"]')).toHaveCount(1);
    await card.getByRole('link', { name: 'Check payment status' }).click();
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await expect(page.getByText('Payment not processed', { exact: true })).toHaveCount(0);
    expect(w.posts()).toBe(0); expect(await w.api.confirms()).toBe(0);
    await page.screenshot({ path: `${shots}/unconfirmed-checkout-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.goBack();
    await expect(card.getByText('Processing', { exact: true })).toBeVisible();
    w.finish('DECLINED'); await page.clock.fastForward(16000);
    const failure = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
    await expect(page.getByText(failure, { exact: true })).toHaveCount(1);
    await page.clock.runFor(600);
    await expect(page.getByRole('heading', { name: 'Pending purchases', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Failed payments', exact: true })).toBeVisible();
    await expect(card.getByText('Payment failed', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${shots}/confirmed-decline-${width}.png`, fullPage: true, animations: 'disabled' });
    await card.getByRole('link', { name: /^Try Again/ }).click();
    await expect(page).toHaveURL(/checkout\?step=payment/);
    const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
    await expect(frame.getByLabel('Mock card number')).toBeVisible();
    await expect(frame.getByLabel('Mock card number')).toHaveValue('');
    await page.reload();
    await expect(frame.getByLabel('Mock card number')).toBeVisible();
    await expect(frame.getByLabel('Mock card number')).toHaveValue('');
    expect(await w.api.confirms()).toBe(0);
    expect(w.api.requests.filter(request => /\/(submit|reconcile)$/.test(request.path))).toHaveLength(0);
  });
  test('an explicit submitted-purchase route never depends on an empty active Cart or a storage pointer', async ({ page }) => {
    const w = await world(page);
    await page.goto(`/checkout?purchase=${attemptId}`);
    await page.screenshot({ path: `${shots}/reentry-before-${width}.png`, fullPage: true, animations: 'disabled' });
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
    await page.reload(); await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await page.getByRole('link', { name: /^Cart, / }).click();
    await page.getByRole('link', { name: 'Check payment status', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('purchase=' + attemptId));
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/\/cart/); await page.goForward();
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    expect(w.posts()).toBe(0); expect(await w.api.confirms()).toBe(0);
    await page.screenshot({ path: `${shots}/reentry-after-${width}.png`, fullPage: true, animations: 'disabled' });
  });
  for (const terminal of ['DECLINED', 'PAID']) test(`a delayed empty purchases projection appears live, then transitions to ${terminal} without reload`, async ({ page }) => {
    await page.clock.install(); const w = await world(page, false, false);
    await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click();
    await expect.poll(w.checks).toBe(1);
    await page.getByRole('link', { name: /^Cart, / }).click(); await page.clock.runFor(1000);
    await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${shots}/live-before-${terminal}-${width}.png`, fullPage: true, animations: 'disabled' });
    w.publish(); await page.clock.fastForward(16000);
    await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toBeVisible();
    await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toContainText('Processing');
    w.multiple(); w.finish(terminal); await page.clock.fastForward(16000);
    const message = terminal === 'PAID' ? 'Payment successful! Your order has been confirmed.' : 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    // Let the existing 450ms purchase exit finish before checking/capturing the settled layout.
    await page.clock.runFor(600);
    if (terminal === 'PAID') {
      await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveCount(0);
    } else {
      await expect(page.getByRole('heading', { name: 'Failed payments', exact: true })).toBeVisible();
      await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toBeVisible();
      await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toContainText('Payment failed');
    }
    await expect(page.locator(`article[data-purchase="${otherId}"]`)).toContainText('Processing');
    // Purchase A, another purchase, and Cart B intentionally have the SAME product name.
    await expect(page.getByRole('heading', { name: product, exact: true })).toBeVisible();
    await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText('$719.00');
    expect(await w.api.confirms()).toBe(1); expect(w.checks()).toBe(1);
    await page.screenshot({ path: `${shots}/live-after-${terminal}-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.clock.fastForward(5100); await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await page.clock.fastForward(16000); await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  });
  test('status transport failure is recoverable, and an ordinary empty Checkout stays empty', async ({ page }) => {
    const w = await world(page); w.down(true);
    await page.goto(`/checkout?purchase=${attemptId}`);
    await expect(page.getByRole('heading', { name: 'We couldn’t verify your payment right now' })).toBeVisible();
    w.down(false); await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    await page.goto('/checkout?step=shipping');
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    expect(w.posts()).toBe(0); expect(await w.api.confirms()).toBe(0);
  });
});
