import { test, expect, type Page } from '@playwright/test';
import { harness, attemptId, fillCard, review, paidConfirmation } from './stripe.harness';
import { cart, shipping } from '../../src/features/checkout/fixtures';
import type { SavedPurchase } from '../../src/features/checkout/PaymentPurchases';

// Real Chromium / real React; all API and Stripe boundaries intercepted. No payment or database operations.
const success = 'Payment successful! Your order has been confirmed.';
const failure = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
const shots = '../../.cache/payment-success-sync/shots';
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function world(page: Page, retry: boolean, changed = false, conflict = false) {
  const api = await harness(page);
  const submittedAt = '2026-10-15T08:00:00.000Z';
  let stamp = '2026-10-15T08:00:00.000Z';
  const cartB = { ...cart, revision: 'b'.repeat(64), subtotal: '42.00', total: '42.00', totalQuantity: 1,
    items: [{ ...cart.items[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 1, lineTotal: '42.00',
      product: { ...cart.items[0].product!, name: 'Independent Cart B', price: '42.00' } }] };
  let activeCart = retry ? cartB : cart;
  const row = (state: string, unread = false): SavedPurchase => ({ attemptId, state, scope: 'CART_CHECKOUT', updatedAt: stamp,
    classification: state === 'PAID' ? 'SUCCEEDED' : state === 'DECLINED' ? 'DECLINED' : 'ORDER_PROCESSING',
    total: cart.total, currency: 'USD', submittedAt, pending: !['PAID', 'DECLINED'].includes(state), unread,
    retryAllowed: state === 'DECLINED', orderReference: state === 'PAID' ? paidConfirmation.orderReference : null,
    items: [{ name: 'Saved purchase A', quantity: 1 }] });
  const gate = barrier(); let started = false; let outcomeState = retry ? 'DECLINED' : 'CAPTURE_PENDING';
  let rows: SavedPurchase[] = retry ? [row('DECLINED')] : [];
  const acknowledgements: string[] = []; let orderReads = 0; let listReads = 0; let resumes = 0; let reconciliations = 0;
  const outcome = () => ({ ...row(outcomeState), intentId: 'pi_intercepted', committed: outcomeState === 'PAID', recoveryActive: false,
    confirmation: outcomeState === 'PAID' ? paidConfirmation : null, cart: activeCart, recoveryRemainder: null });
  await page.route('**/api/cart', route => route.fulfill({ json: { data: activeCart } }));
  await page.route('**/api/checkout/payment-attempts**', async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    if (method === 'GET' && path.endsWith('/payment-attempts')) { listReads++; return route.fulfill({ json: { data: rows } }); }
    if (path.endsWith('/read')) {
      const state = route.request().postDataJSON().state; acknowledgements.push(state);
      rows = rows.flatMap(item => item.state !== state ? [item] : state === 'PAID' ? [] : [{ ...item, unread: false }]);
      return route.fulfill({ json: { data: {} } });
    }
    if (path.endsWith('/resume')) {
      resumes++;
      if (changed) return route.fulfill({ status: 409, json: { error: { code: 'CHECKOUT_CHANGED', message: 'Saved purchase availability or pricing changed.' } } });
      if (conflict) return route.fulfill({ status: 409, json: { error: { code: 'PAYMENT_RECOVERY_PENDING', message: 'Check the saved payment before retrying.' } } });
      if (outcomeState !== 'DECLINED') return route.fulfill({ status: 409, json: { error: { code: 'PAYMENT_RECOVERY_PENDING', message: 'Check the saved payment before retrying.' } } });
      return route.fulfill({ json: { data: { ...outcome(), clientSecret: 'pi_intercepted_secret_fixture',
      request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision },
      items: [{ name: 'Saved purchase A', quantity: 1 }], delivery: null, replayed: true } } });
    }
    if (path.endsWith('/reconcile')) { reconciliations++; started = true; await gate.promise; return route.fulfill({ json: { data: outcome() } }).catch(() => undefined); }
    if (path === `/api/checkout/payment-attempts/${attemptId}` && method === 'GET') return route.fulfill({ json: { data: outcome() } });
    return route.fallback();
  });
  await page.route('**/api/orders**', route => {
    if (new URL(route.request().url()).pathname === '/api/orders') {
      orderReads++; return route.fulfill({ json: { data: outcomeState === 'PAID' ? [paidConfirmation] : [], meta: { page: 1, pageSize: 10, total: outcomeState === 'PAID' ? 1 : 0, totalPages: 1 } } });
    }
    return route.fulfill({ json: { data: outcomeState === 'PAID' ? paidConfirmation : { ...paidConfirmation, paymentState: 'PENDING' } } });
  });
  return { api, gate, acknowledgements, started: () => started, orderReads: () => orderReads, listReads: () => listReads, resumes: () => resumes, reconciliations: () => reconciliations,
    processing: () => { outcomeState = 'CAPTURE_PENDING'; activeCart = cartB; rows = [row(outcomeState)]; },
    set: (state: 'PAID' | 'DECLINED') => { stamp = '2026-10-15T08:01:00.000Z'; outcomeState = state; rows = [row(state, true)]; },
    resolve: (state: 'PAID' | 'DECLINED') => { stamp = '2026-10-15T08:01:00.000Z'; outcomeState = state; rows = [row(state, true)]; gate.release(); },
  };
}
async function goCart(page: Page) { await page.getByRole('link', { name: /^Cart, / }).click(); await expect(page).toHaveURL(/\/cart/); }

for (const width of [390, 1366]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test('eligible retry requires fresh Payment entry and explicit Review and Place Order, including reload and history', async ({ page }) => {
      const w = await world(page, true);
      try {
        await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).click();
        await expect(page).toHaveURL(/checkout\?step=payment/);
        const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
        await expect(frame.getByLabel('Mock card number')).toBeVisible();
        await expect(frame.getByLabel('Mock card number')).toHaveValue('');
        await expect(page.getByRole('heading', { name: /This purchase can’t|Processing Payment|Order Confirmed/ })).toHaveCount(0);
        await expect(page.locator('#processing-heading')).toHaveCount(0);
        await expect(page.getByText(success, { exact: true })).toHaveCount(0);
        expect(await w.api.confirms()).toBe(0); expect(w.reconciliations()).toBe(0);
        await page.getByRole('button', { name: 'Review Order' }).click();
        await expect(page).toHaveURL(/step=payment/); // Empty secure entry cannot be bypassed.
        await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
        await expect(page).toHaveURL(/step=review/);
        await page.reload();
        // No card completion survives the secure iframe being destroyed.
        await expect(page).toHaveURL(/step=payment/);
        await expect(frame.getByLabel('Mock card number')).toBeVisible();
        await expect(frame.getByLabel('Mock card number')).toHaveValue('');
        expect(await w.api.confirms()).toBe(0); expect(w.reconciliations()).toBe(0);
        await goCart(page); await page.goBack();
        await expect(page).toHaveURL(/step=payment/);
        await expect(frame.getByLabel('Mock card number')).toHaveValue('');
        await page.reload(); await expect(frame.getByLabel('Mock card number')).toBeVisible();
        expect(await w.api.confirms()).toBe(0); expect(w.reconciliations()).toBe(0);
        await page.screenshot({ path: '../../.cache/payment-retry-followup/payment-entry-' + width + '.png', fullPage: true, animations: 'disabled' });
        await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
        await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
        await expect(page.locator('#processing-heading')).toHaveCount(0);
        expect(await w.api.confirms()).toBe(0); expect(w.reconciliations()).toBe(0);
        await page.getByRole('button', { name: /Place Order/ }).click(); await expect.poll(w.started).toBe(true);
        await expect(page.locator('#processing-heading')).toBeVisible();
        expect(await w.api.confirms()).toBe(1); expect(w.reconciliations()).toBe(1);
        w.resolve('PAID');
        await expect(page).toHaveURL(new RegExp('/checkout/confirmation/' + paidConfirmation.orderReference));
        await expect(page.getByRole('heading', { name: 'Order Confirmed' })).toBeVisible();
        expect(w.api.requests.filter(item => item.method === 'POST' && item.path === '/api/checkout/payment-attempts')).toHaveLength(0);
        expect(w.api.requests.filter(item => item.method !== 'GET' && item.path.startsWith('/api/cart'))).toHaveLength(0);
        await goCart(page); await expect(page.getByRole('heading', { name: 'Independent Cart B' })).toBeVisible();
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveCount(0);
      } finally { w.gate.release(); }
    });
    for (const state of ['PAID', 'UNKNOWN', 'PROCESSING'] as const) {
      test(`a stale failed Cart card cannot retry an authoritative ${state} outcome`, async ({ page }) => {
        const w = await world(page, true);
        await page.route(`**/api/checkout/payment-attempts/${attemptId}`, route => {
          // One authoritative fixture truth across status, purchases and Orders.
          if (state === 'PAID') w.set('PAID');
          return route.fulfill({ json: { data: {
          attemptId, intentId: 'pi_intercepted', state: state === 'UNKNOWN' ? 'DECLINED' : state,
          classification: state === 'PAID' ? 'SUCCEEDED' : state, recoveryActive: false, retryAllowed: state === 'PAID' ? false : true,
          total: cart.total, currency: 'USD', committed: state === 'PAID',
          orderReference: state === 'PAID' ? paidConfirmation.orderReference : null,
          confirmation: state === 'PAID' ? paidConfirmation : null,
          } } });
        });
        await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).click();
        if (state === 'PAID') await expect(page.getByRole('heading', { name: 'Order Confirmed' })).toBeVisible();
        else await expect(page.getByRole('heading', { name: /Checking your payment|We couldn’t confirm your payment yet/ })).toBeVisible();
        await expect(page.locator('iframe[title="Mock hosted card entry — intercepted UI test"]')).toHaveCount(0);
        expect(w.resumes()).toBe(0); expect(w.reconciliations()).toBe(0); expect(await w.api.confirms()).toBe(0);
      });
    }
    test('an explicitly submitted retry can fail again and the NEXT Try Again starts with empty card entry', async ({ page }) => {
      const w = await world(page, true);
      try {
        await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).click();
        await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
        await page.evaluate(() => { Reflect.get(window, '__stripeFixture').behavior = 'decline'; });
        expect(await w.api.confirms()).toBe(0);
        await page.getByRole('button', { name: /Place Order/ }).click(); await expect.poll(w.started).toBe(true);
        w.resolve('DECLINED');
        await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
        await page.getByRole('button', { name: 'Try Again', exact: true }).click();
        await expect(page).toHaveURL(/step=payment/);
        const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
        await expect(frame.getByLabel('Mock card number')).toBeVisible();
        await expect(frame.getByLabel('Mock card number')).toHaveValue('');
        await expect(page.getByRole('heading', { name: /Order Confirmed|Processing Payment/ })).toHaveCount(0);
        await expect(page.locator('#processing-heading')).toHaveCount(0);
        expect(await w.api.confirms()).toBe(1); expect(w.reconciliations()).toBe(1);
        await goCart(page); await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Independent Cart B' })).toBeVisible();
        await expect(page.getByText(success, { exact: true })).toHaveCount(0);
      } finally { w.gate.release(); }
    });
    test('a recovery conflict with a still-stale decline remains Checking and never invites another confirmation', async ({ page }) => {
      const w = await world(page, true, false, true);
      await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).click();
      await expect(page.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'This purchase can’t be paid again right now' })).toHaveCount(0);
      await expect(page.getByText(/Nothing was charged/)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('heading', { name: /Checking your payment|We couldn’t confirm your payment yet/ })).toBeVisible();
      expect(w.resumes()).toBe(1); expect(await w.api.confirms()).toBe(0); expect(w.reconciliations()).toBe(0);
    });
    test('returning to review during processing restores Checking instead of the screenshot rejection', async ({ page }) => {
      const w = await world(page, true);
      try {
        await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).click();
        await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
        await page.getByRole('button', { name: /Place Order/ }).click(); await expect.poll(w.started).toBe(true);
        w.processing(); await goCart(page); await page.goBack();
        await expect(page).toHaveURL(/checkout\?step=review/);
        // Capture the exact observed incorrect screen on the unfixed source.
        if (await page.getByRole('heading', { name: 'This purchase can’t be paid again right now' }).isVisible().catch(() => false)) {
          await page.screenshot({ path: `${shots}/rejection-before-${width}.png`, fullPage: true, animations: 'disabled' });
        }
        await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
        await page.screenshot({ path: `${shots}/checking-review-${width}.png`, fullPage: true, animations: 'disabled' });
        await page.reload(); await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
        await page.goBack(); await page.goForward(); await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
        expect(w.resumes()).toBe(1);
        await goCart(page); w.resolve('PAID');
        await expect(page.getByText(success, { exact: true })).toBeVisible({ timeout: 20000 });
      } finally { w.gate.release(); }
    });
    test('failed → retry → leave during reconciliation → PAID: Cart and toast follow the same outcome', async ({ page }) => {
      const w = await world(page, true);
      try {
        await page.goto('/orders'); await expect(page.getByRole('heading', { name: 'You have no orders yet.' })).toBeVisible();
        await goCart(page);
        await page.getByRole('link', { name: /^Try Again/ }).click();
        await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
        await page.getByRole('button', { name: /Place Order/ }).click();
        await expect.poll(w.started).toBe(true);
        await goCart(page);
        // The server may still expose the PREVIOUS decline while the new confirmation is in flight.
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toContainText('Processing');
        await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
        w.resolve('PAID');
        await expect(page.getByText(success, { exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/cart/);
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveCount(0);
        expect(w.acknowledgements).toEqual([]);
        await page.screenshot({ path: `${shots}/retry-paid-${width}.png`, fullPage: true, animations: 'disabled' });
        await expect(page.getByRole('heading', { name: 'Independent Cart B' })).toBeVisible();
        expect(w.resumes()).toBe(1); expect(w.reconciliations()).toBe(1); expect(await w.api.confirms()).toBe(1);
        expect(w.api.requests.filter(item => item.method === 'POST' && item.path === '/api/checkout/payment-attempts')).toHaveLength(0);
        expect(w.api.requests.filter(item => item.method !== 'GET' && item.path.startsWith('/api/cart'))).toHaveLength(0);
        await page.getByRole('link', { name: 'Orders', exact: true }).last().click();
        await expect(page.getByRole('heading', { name: paidConfirmation.orderReference })).toBeVisible();
        await expect(page.getByText('Paid', { exact: true })).toBeVisible();
        await page.screenshot({ path: `${shots}/orders-paid-${width}.png`, fullPage: true, animations: 'disabled' });
        await page.mouse.move(0, 0); await expect(page.getByText(success, { exact: true })).toHaveCount(0, { timeout: 9000 });
        await expect.poll(() => w.acknowledgements.filter(state => state === 'PAID').length).toBe(1);
        await page.reload(); await page.goBack(); await page.goForward();
        await expect(page.getByText(success, { exact: true })).toHaveCount(0);
      } finally { w.gate.release(); }
    });
    test('delayed reconciliation keeps observing after the response and updates cached Orders without navigation', async ({ page }) => {
      await page.clock.install(); const w = await world(page, false);
      try {
        await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click();
        await expect.poll(w.started).toBe(true); w.processing(); w.gate.release();
        await goCart(page); await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toContainText('Processing');
        await expect(page.getByText(success, { exact: true })).toHaveCount(0);
        w.set('PAID'); await page.clock.fastForward(16000);
        await expect(page.getByText(success, { exact: true })).toBeVisible();
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Independent Cart B' })).toBeVisible();
        await page.clock.fastForward(5100); await expect(page.getByText(success, { exact: true })).toHaveCount(0);
        await expect.poll(() => w.acknowledgements).toEqual(['PAID']);
        expect(w.reconciliations()).toBe(1); expect(await w.api.confirms()).toBe(1);
      } finally { w.gate.release(); }
    });
    test('pending → confirmed failure keeps the failed card and existing retry action', async ({ page }) => {
      const w = await world(page, false);
      try {
        await page.goto('/checkout'); await review(page); await page.getByRole('button', { name: /Place Order/ }).click();
        await expect.poll(w.started).toBe(true); w.processing(); await goCart(page); w.resolve('DECLINED');
        await expect(page.getByText(failure, { exact: true })).toBeVisible();
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toContainText('Payment failed');
        await expect(page.getByRole('link', { name: /^Try Again/ })).toBeVisible();
        await expect(page.getByText(success, { exact: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Independent Cart B' })).toBeVisible();
      } finally { w.gate.release(); }
    });
    test('genuine changed-price rejection stays safe and never asserts that nothing was charged', async ({ page }) => {
      const w = await world(page, true, true);
      await page.goto('/cart'); await page.getByRole('link', { name: /^Try Again/ }).click();
      await expect(page.getByRole('heading', { name: 'This purchase can’t be paid again right now' })).toBeVisible();
      await expect(page.getByText('Prices, availability or delivery terms changed. Review this saved purchase in Cart before trying again.')).toBeVisible();
      await expect(page.getByText(/Nothing was charged/)).toHaveCount(0);
      expect(w.reconciliations()).toBe(0); expect(await w.api.confirms()).toBe(0);
    });
    test('new payment → processing → Cart → delayed authoritative PAID updates automatically', async ({ page }) => {
      const w = await world(page, false);
      try {
        await page.goto('/checkout'); await review(page);
        await page.getByRole('button', { name: /Place Order/ }).click(); await expect.poll(w.started).toBe(true);
        w.processing(); await goCart(page);
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toContainText('Processing');
        await expect(page.getByText(success, { exact: true })).toHaveCount(0);
        w.resolve('PAID');
        await expect(page.getByText(success, { exact: true })).toBeVisible({ timeout: 20000 });
        await expect(page.locator(`article[data-purchase="${attemptId}"]`)).toHaveCount(0);
        await page.screenshot({ path: `${shots}/new-paid-${width}.png`, fullPage: true, animations: 'disabled' });
      } finally { w.gate.release(); }
    });
  });
}
