import { test, expect } from '@playwright/test';
import { harness, review, fillShipping, fillCard } from './stripe.harness';
const purchase = { attemptId: '79972f29-3ac6-4093-aee8-5d148acc95a4', scope: 'CART_CHECKOUT', state: 'PROCESSING', classification: 'PROCESSING', total: '49.00', currency: 'USD', pending: true, unread: false, orderReference: null, items: [{ name: 'Lenovo Go USB-C Wireless Mouse', quantity: 1 }] };
for (const state of ['PAID', 'DECLINED']) test('Cart inline ' + state + ' removal preserves B, toasts once and keeps failure history', async ({ page }) => {
  await page.clock.install(); await harness(page); let done = false;
  await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state: done ? state : 'PROCESSING', classification: done ? state === 'PAID' ? 'SUCCEEDED' : 'DECLINED' : 'PROCESSING', pending: !done, unread: done, retryAllowed: done && state === 'DECLINED', orderReference: done && state === 'PAID' ? 'ORD-A' : null }] } }));
  await page.goto('/cart'); await expect(page.getByText(purchase.items[0].name)).toBeVisible();
  const before = await page.getByRole('button', { name: 'Proceed to Checkout' }).isEnabled();
  await page.screenshot({ path: 'test-results/purchases/manual-before-' + state + '.png', fullPage: true });
  done = true; await page.clock.fastForward(15001);
  const row = page.locator('[data-outcome]'); await expect(row).toHaveCount(1);
  // Freeze the 450 ms exit first so the inline result can be inspected; then check the single global toast.
  await row.evaluate(element => { for (const animation of element.parentElement?.parentElement?.getAnimations() ?? []) { animation.pause(); animation.currentTime = 100; } });
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/purchases/manual-inline-' + state + '.png', fullPage: true });
  await page.clock.fastForward(451); await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  if (state === 'DECLINED') await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(state === 'DECLINED' ? 1 : 0);
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(1);
  expect(await page.getByRole('button', { name: 'Proceed to Checkout' }).isEnabled()).toBe(before);
  await page.screenshot({ path: 'test-results/purchases/manual-after-' + state + '.png', fullPage: true });
});
for (const state of ['PAID', 'DECLINED']) test('Home ' + state + ' toast dismisses after five seconds', async ({ page }) => {
  await harness(page); await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state, classification: state === 'PAID' ? 'SUCCEEDED' : 'DECLINED', pending: false, unread: true }] } }));
  await page.goto('/'); const text = page.getByText(state === 'PAID' ? 'Payment successful! Your order has been confirmed.' : 'Payment was not completed. Your saved purchase details are kept in your Cart history.', { exact: true });
  await expect(text).toBeVisible(); await text.evaluate(async element => { await Promise.all(element.closest('li')?.getAnimations().map(animation => animation.finished) ?? []); });
  await page.screenshot({ path: 'test-results/purchases/manual-home-' + state + '.png', fullPage: true });
  await expect(text).toBeHidden({ timeout: 8000 }); await expect(page).toHaveURL(/\/$/);
});
test('already declined purchase is saved, not pending', async ({ page }) => {
  await harness(page); await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true }] } }));
  await page.goto('/cart'); await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveAttribute('href', '/checkout?step=payment');
});
test('UNKNOWN stays pending on mobile, no failure or retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 852 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await harness(page);
  await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, classification: 'UNKNOWN' }] } }));
  await page.goto('/cart'); await expect(page.getByText('Awaiting confirmation')).toBeVisible(); await expect(page.getByRole('link', { name: 'Try Again' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/purchases/manual-mobile-pending.png', fullPage: true });
});
test('an unresolved reconciliation moves from Processing to the animated Checking your payment view', async ({ page }) => {
  await harness(page, { state: 'PROCESSING' }); await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click(); await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'confirming the result with our payment provider' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try Again|View Orders/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View Payment Status' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/purchases/manual-processing.png', fullPage: true });
});
test('legacy URL redirects safely without payment setup', async ({ page }) => {
  await harness(page); await page.goto('/account/payment-status/' + purchase.attemptId); await expect(page).toHaveURL(/\/cart\?purchase=/);
});
test('new B Stripe form stays independent of failed saved A', async ({ page }) => {
  await harness(page); await page.route('**/api/checkout/payment-attempts', route => route.request().method() === 'GET' ? route.fulfill({ json: { data: [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true }] } }) : route.fallback());
  await page.goto('/checkout'); await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click(); await fillCard(page); await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/purchases/manual-new-B.png', fullPage: true });
});

test('completion outside Cart preserves Checkout B shipping and route', async ({ page }) => {
  await page.clock.install(); await harness(page); let done = false;
  await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state: done ? 'PAID' : 'PROCESSING', classification: done ? 'SUCCEEDED' : 'PROCESSING', pending: !done, unread: done }] } }));
  await page.goto('/checkout'); await page.locator('#shipping-recipient').fill('Checkout B recipient'); done = true; await page.clock.fastForward(15001);
  await expect(page.getByText('Payment successful! Your order has been confirmed.', { exact: true })).toBeVisible();
  await expect(page.locator('#shipping-recipient')).toHaveValue('Checkout B recipient'); await expect(page).toHaveURL(/checkout/);
  await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
});
test('storage-disabled browsers still receive a result toast', async ({ page }) => {
  await harness(page); await page.addInitScript(() => { const get = Storage.prototype.getItem; const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key.startsWith('electrohub.payment-notice.')) throw new Error('denied'); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('electrohub.payment-notice.')) throw new Error('denied'); return set.call(this, key, value); };
  });
  await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true }] } }));
  await page.goto('/'); await expect(page.getByText('Payment successful! Your order has been confirmed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
});
test('shared-storage tabs deduplicate terminal notification', async ({ page, context }) => {
  const second = await context.newPage(); await harness(page); await harness(second);
  for (const tab of [page, second]) await tab.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state: 'PAID', classification: 'SUCCEEDED', unread: true, pending: false }] } }));
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toBeVisible(); await second.goto('/');
  await expect(second.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(0); await second.close();
});

test('Cart offers an explicit Try Again and the legacy retry URL never resumes a payment', async ({ page }) => {
  await harness(page); const resumes: string[] = [];
  await page.route('**/api/checkout/payment-attempts', route => route.fulfill({ json: { data: [{ ...purchase, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true }] } }));
  await page.route('**/api/checkout/payment-attempts/*/resume', route => { resumes.push(route.request().url()); return route.abort(); });
  await page.goto('/cart'); await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
  await page.goto('/account/payment-retry/' + purchase.attemptId);
  await expect(page).toHaveURL(new RegExp('/cart[?]purchase=' + purchase.attemptId + '$'));
  await expect(page.getByRole('heading', { name: 'Complete your saved purchase' })).toHaveCount(0);
  expect(resumes).toHaveLength(0);
  await page.screenshot({ path: 'test-results/purchases/manual-legacy-retry-redirect.png', fullPage: true });
});
