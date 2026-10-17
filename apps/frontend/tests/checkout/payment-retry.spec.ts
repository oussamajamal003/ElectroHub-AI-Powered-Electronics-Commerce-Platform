import { expect, test, type Page } from '@playwright/test';
import { harness, review, attemptId, paidConfirmation } from './stripe.harness';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';
import { cart, shipping } from '../../src/features/checkout/fixtures';

// INTERCEPTED APIs and Stripe SDK fixture (real Chromium, real app). Proves UI transitions and request
// boundaries only — no provider calls, no database writes, no real financial acceptance.
const toastClose = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });
const failureToast = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';
const cartB = { ...cart, total: '42.00', subtotal: '42.00', revision: 'b'.repeat(64) };
const tryAgainLink = (page: Page) => page.getByRole('link', { name: /^Try Again/ });
const idB = '77777777-7777-4777-8777-777777777777';
const submittedAt = new Date().toISOString();
const base = { state: 'DECLINED', submittedAt, scope: 'CART_CHECKOUT', providerStatus: 'requires_payment_method', failureCode: 'PAYMENT_DECLINED', currency: 'USD',
  orderReference: null, committed: false, cart: cartB, recoveryRemainder: null, recoveryActive: false, confirmation: null, retryAllowed: true, clientSecret: 'pi_intercepted_secret_fixture', replayed: true };
const resumeA = { ...base, attemptId, total: '378.00', request: { shipping: { ...shipping, recipient: 'Avery Saved-A', city: 'Springfield A' }, deliveryMethod: 'EXPRESS', paymentMethod: 'CARD' },
  items: [{ name: 'Apple Watch Series 9', quantity: 1, imageUrl: null }, { name: 'Sport Band', quantity: 2, imageUrl: null }] };
const resumeB = { ...base, attemptId: idB, total: '49.00', request: { shipping: { ...shipping, recipient: 'Blake Saved-B', city: 'Shelbyville B' }, deliveryMethod: 'STANDARD', paymentMethod: 'CARD' },
  items: [{ name: 'Lenovo Go USB-C Wireless Mouse', quantity: 1, imageUrl: null }] };
const savedList = () => [
  savedPurchase({ attemptId, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true, total: '378.00', items: resumeA.items }),
  savedPurchase({ attemptId: idB, state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true, total: '49.00', items: resumeB.items }),
  savedPurchase({ attemptId: '12121212-1212-4121-8121-121212121212', state: 'PROCESSING', classification: 'PROCESSING', items: [{ name: 'Pending Speaker', quantity: 1 }] }),
  savedPurchase({ attemptId: '34343434-3434-4343-8343-343434343434', state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: false, items: [{ name: 'Paid Charger', quantity: 1 }] }),
];
async function savedPurchasesPage(page: Page) {
  const api = await harness(page);
  await page.route('**/api/cart', route => route.fulfill({ json: { data: cartB } }));
  await routeSavedPurchases(page, savedList);
  const resumes: string[] = [];
  await page.route('**/api/checkout/payment-attempts/*/resume', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!; resumes.push(id);
    return route.fulfill({ json: { data: id === idB ? resumeB : resumeA } });
  });
  return { api, resumes };
}
const setupPosts = (api: Awaited<ReturnType<typeof harness>>) => api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts');
const cartWrites = (api: Awaited<ReturnType<typeof harness>>) => api.requests.filter(request => request.path.startsWith('/api/cart') && request.method !== 'GET');

for (const width of [390, 768, 1440, 1920]) {
  test(`Cart failed-purchase cards and Try Again → restored Payment step at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { api, resumes } = await savedPurchasesPage(page);
    await page.goto('/cart');
    // 7. One grouped card per purchase identity; 8/9. pending and paid purchases have no Try Again.
    const cardA = page.locator(`article[data-purchase="${attemptId}"]`);
    await expect(cardA).toBeVisible({ timeout: 15_000 });
    await expect(cardA.getByText('Apple Watch Series 9', { exact: true })).toBeVisible(); await expect(cardA.getByText('Sport Band', { exact: true })).toBeVisible();
    await expect(cardA.getByText('Payment failed')).toBeVisible(); await expect(cardA.getByText('$378.00')).toBeVisible();
    await expect(page.locator('article[data-purchase]')).toHaveCount(3); // A, B (failed) + pending speaker row
    await expect(tryAgainLink(page)).toHaveCount(2);
    await expect(page.locator('article[data-purchase="12121212-1212-4121-8121-121212121212"]').getByRole('link')).toHaveCount(0);
    await expect(page.getByText('Paid Charger')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await cardA.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `screenshots/scenario1-final/addendum2-cart-cards-${width}.png`, fullPage: true });
    // 1/2. Try Again → the Checkout Payment step with A's exact saved items, never "Your cart is empty".
    await cardA.getByRole('link', { name: /^Try Again/ }).click();
    await expect(page).toHaveURL(/\/checkout[?]step=payment$/);
    await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
    for (const obsolete of ['Complete your saved purchase', 'Checking retry eligibility', 'View Saved Purchases']) await expect(page.getByText(obsolete)).toHaveCount(0);
    const summary = page.getByRole('complementary', { name: 'Order Summary' });
    // 12. The Payment step names the saved purchase being retried (A's items, verified total, destination, delivery).
    await expect(summary.getByText('Retrying payment for this purchase')).toBeVisible();
    await expect(summary.getByText(/Avery Saved-A/)).toBeVisible(); await expect(summary.getByText('Express')).toBeVisible();
    if (width < 1024) expect((await summary.boundingBox())!.y).toBeLessThan((await page.getByRole('heading', { name: 'Payment Method' }).boundingBox())!.y);
    await expect(summary.getByText('Apple Watch Series 9')).toBeVisible(); await expect(summary.getByText('Qty: 2')).toBeVisible();
    await expect(summary.getByText('$378.00')).toBeVisible();
    await expect(summary.getByText('Cart Product')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `screenshots/scenario1-final/addendum2-retry-payment-${width}.png`, fullPage: true });
    expect(resumes).toEqual([attemptId]);
    expect(setupPosts(api)).toHaveLength(0); expect(cartWrites(api)).toHaveLength(0);
  });
}

test('A and B restore their OWN shipping/delivery; Back/edit keeps identity; Cart B untouched', async ({ page }) => {
  const { api, resumes } = await savedPurchasesPage(page);
  await page.goto('/cart');
  await page.locator(`article[data-purchase="${attemptId}"]`).getByRole('link', { name: /^Try Again/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
  // 3/12. Back through Delivery and Shipping shows A's saved selections and keeps A's identity.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Delivery Method' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Express Delivery' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText(/Avery Saved-A/).first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/scenario1-final/addendum2-retry-shipping-A.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue to Delivery' }).click(); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('complementary', { name: 'Order Summary' }).getByText('Apple Watch Series 9')).toBeVisible();
  // 4/5. B restores different saved data; nothing of A leaks.
  await page.goto('/cart');
  await page.locator(`article[data-purchase="${idB}"]`).getByRole('link', { name: /^Try Again/ }).click();
  await expect(page.getByRole('complementary', { name: 'Order Summary' }).getByText('Lenovo Go USB-C Wireless Mouse')).toBeVisible();
  await expect(page.getByText('Apple Watch Series 9')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Standard Delivery' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText(/Blake Saved-B/).first()).toBeVisible(); await expect(page.getByText(/Avery Saved-A/)).toHaveCount(0);
  expect(resumes).toEqual([attemptId, idB]);
  // 6. Cart B is unaffected: no Cart writes, and Cart still shows B.
  expect(cartWrites(api)).toHaveLength(0);
  await page.goto('/cart'); await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  expect(setupPosts(api)).toHaveLength(0);
});

test('13. Payment → Review → Place Order: one confirmation of the same attempt, no new intent or submission', async ({ page }) => {
  const { api } = await savedPurchasesPage(page);
  await page.goto('/cart');
  await page.locator(`article[data-purchase="${attemptId}"]`).getByRole('link', { name: /^Try Again/ }).click();
  const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
  await frame.getByLabel('Mock card number').fill('4242424242424242'); await frame.getByLabel('Mock expiry').fill('1230'); await frame.getByLabel('Mock security code').fill('123');
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
  expect(await api.confirms()).toBe(0); // retry never submits on its own
  const reconciles: string[] = [];
  await page.route(`**/api/checkout/payment-attempts/*/reconcile`, route => { reconciles.push(new URL(route.request().url()).pathname); return route.fulfill({ json: { data: { ...resumeA, state: 'PAID', providerStatus: 'succeeded',
    failureCode: null, committed: true, orderReference: paidConfirmation.orderReference, confirmation: paidConfirmation } } }); });
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible();
  expect(await api.confirms()).toBe(1);
  expect(api.requests.filter(request => request.path.endsWith('/submit'))).toHaveLength(0);
  expect(reconciles).toEqual([`/api/checkout/payment-attempts/${attemptId}/reconcile`]);
  expect(setupPosts(api)).toHaveLength(0);
  await expect(toastClose(page)).toHaveCount(0); // the outcome was shown on screen
});

test('10. an ineligible or changed saved snapshot shows an accurate recoverable state', async ({ page }) => {
  const api = await harness(page);
  await routeSavedPurchases(page, savedList);
  await page.route('**/api/checkout/payment-attempts/*/resume', route => route.fulfill({ status: 409, json: { error: { code: 'CHECKOUT_CHANGED', message: 'Saved purchase availability or pricing changed.' } } }));
  await page.goto('/cart');
  await page.locator(`article[data-purchase="${attemptId}"]`).getByRole('link', { name: /^Try Again/ }).click();
  await expect(page.getByRole('heading', { name: 'This purchase can’t be paid again right now' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Your cart is empty|Payment Method/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to Cart' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/scenario1-final/addendum2-retry-ineligible.png', fullPage: true });
  expect(setupPosts(api)).toHaveLength(0);
});

test('Payment Failed on screen → no toast → Try Again → restored Payment step (same attempt)', async ({ page }) => {
  const api = await harness(page, { state: 'DECLINED' });
  await routeSavedPurchases(page, () => [savedPurchase({ state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true, retryAllowed: true })]);
  await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
  await expect.poll(() => api.requests.filter(request => request.method === 'POST' && request.path === `/api/checkout/payment-attempts/${attemptId}/read`).length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1_500);
  await expect(toastClose(page)).toHaveCount(0);
  const setups = setupPosts(api).length;
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page).toHaveURL(/\/checkout[?]step=payment$/);
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Payment Failed|Processing your order|Checking your payment|Your cart is empty/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  expect(api.requests.filter(request => request.path.endsWith('/resume')).map(request => request.path)).toEqual([`/api/checkout/payment-attempts/${attemptId}/resume`]);
  expect(setupPosts(api)).toHaveLength(setups);
});

test('leaving Processing before the result: one failure toast, close icon and 5 s auto-dismiss, never repeated', async ({ page }) => {
  await page.clock.install();
  const api = await harness(page, { state: 'DECLINED' }); api.hold();
  let declined = false;
  const reads = await routeSavedPurchases(page, () => [declined
    ? savedPurchase({ state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true, retryAllowed: true })
    : savedPurchase({ state: 'PROCESSING', classification: 'PROCESSING' })]);
  await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Processing your order…' })).toBeVisible();
  // 4. The customer goes Home before the terminal result; the backend then confirms the failure.
  await page.goto('/');
  declined = true;
  await page.clock.runFor(15_001);
  await expect(toastClose(page)).toHaveCount(1);
  // Freeze page time while the toast is up so the 5 s boundary is measured, not raced.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
  await expect(page.locator('li[data-state="open"]').getByText(failureToast, { exact: true })).toBeVisible();
  await expect(page.getByText(/charged|order (was )?placed/i)).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/scenario1-final/addendum-home-toast.png' });
  // 5. Auto-dismiss: still open well before 5 s, gone after it (the exact boundary is unit-tested with fake timers).
  await page.clock.runFor(2_500);
  await expect(toastClose(page)).toHaveCount(1);
  await page.clock.runFor(3_000);
  await expect(toastClose(page)).toHaveCount(0);
  // 6. Repeated terminal reads and a remount never bring it back.
  const before = reads.count;
  await page.clock.runFor(31_000);
  await page.goto('/products'); await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => reads.count).toBeGreaterThan(before);
  await page.clock.runFor(1_000);
  await expect(toastClose(page)).toHaveCount(0);
});

test('the toast close icon dismisses immediately', async ({ page }) => {
  await harness(page);
  await routeSavedPurchases(page, () => [savedPurchase({ state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true })]);
  await page.goto('/cart');
  await expect(page.getByText(failureToast, { exact: true })).toBeVisible();
  await toastClose(page).click();
  await expect(toastClose(page)).toHaveCount(0, { timeout: 1_000 });
});

test('UNKNOWN cannot start a retry: unconfirmed view offers Check again on the same attempt and never resumes', async ({ page }) => {
  const api = await harness(page, { unknown: true });
  await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: /Checking your payment|We couldn’t confirm your payment yet/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
  await expect(toastClose(page)).toHaveCount(0);
  expect(api.requests.filter(request => request.path.endsWith('/resume'))).toHaveLength(0);
  expect(api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts')).toHaveLength(1);
});

test('legacy /account/payment-retry/:attemptId resolves to Cart history without any payment request', async ({ page }) => {
  const api = await harness(page);
  await routeSavedPurchases(page, () => [savedPurchase({ state: 'DECLINED', classification: 'DECLINED', pending: false, unread: false, retryAllowed: true })]);
  await page.goto(`/account/payment-retry/${attemptId}`);
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  await expect(page.getByText('Complete your saved purchase')).toHaveCount(0);
  // The redirect itself never resumes or creates anything; Try Again stays an explicit customer action on the card.
  expect(api.requests.filter(request => request.method === 'POST' && request.path.startsWith('/api/checkout'))).toHaveLength(0);
});
