import { expect, test, type Page } from '@playwright/test';
import { noSavedPurchases, refreshedSession } from '../../src/test/e2eApiFixtures';
import { cart, quote, shipping } from '../../src/features/checkout/fixtures';

/**
 * Task 06.2 Work Package D: Checkout skeletons. Every API is intercepted (signed-in test customer, fixture Cart/quote); Stripe is
 * never reached because the spec stops before payment setup. Skeletons must appear only while data is genuinely loading,
 * be replaced by the real step, and never stand in for an error.
 */
const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'skeleton-customer@example.invalid', firstName: 'Skeleton', lastName: 'Customer', role: 'CUSTOMER' };
const evidence = (name: string) => `test-results/task06-2-evidence/${name}.png`;

async function signedIn(page: Page, options: { cartDelay?: number; cartStatus?: number; quoteGate?: Promise<void> } = {}) {
  await page.addInitScript(value => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)), user);
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
    if (path === '/api/auth/customer/refresh') return json(refreshedSession(user as never));
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/cart') {
      await wait(options.cartDelay);
      return options.cartStatus ? json({ error: { code: 'INTERNAL_ERROR', message: 'Unavailable' } }, options.cartStatus) : json({ data: cart });
    }
    if (path === '/api/checkout') { await options.quoteGate; return json({ data: quote }); }
    if (path === '/api/checkout/payment-attempts') return json(noSavedPurchases);
    if (path === '/api/wishlist') return json({ data: { items: [], totalItems: 0 } });
    return json({ data: [] });
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Shipping skeleton while the Cart loads, then the real form (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signedIn(page, { cartDelay: 2_500 });
    await page.goto('/checkout?step=shipping', { waitUntil: 'domcontentloaded' });
    const skeleton = page.getByTestId('checkout-skeleton');
    await expect(skeleton).toBeVisible({ timeout: 30_000 });
    await expect(skeleton).toHaveAttribute('data-step', 'shipping');
    await expect(page.getByRole('status').filter({ hasText: 'Loading checkout' })).toBeAttached();
    await page.screenshot({ path: evidence(`checkout-skeleton-shipping-${viewport.width}`), fullPage: true });
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 10_000 });
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
    await page.screenshot({ path: evidence(`checkout-loaded-shipping-${viewport.width}`), fullPage: true });
  });
}

test('A Cart failure shows the error and Retry, never a lingering skeleton', async ({ page }) => {
  await signedIn(page, { cartStatus: 500 });
  await page.goto('/checkout?step=shipping', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Checkout could not load.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Retry Cart' })).toBeVisible();
  await expect(page.getByTestId('checkout-skeleton')).toHaveCount(0);
});

test('Delivery options show their skeleton only while the quote is loading', async ({ page }) => {
  let releaseQuote = () => {};
  const quoteGate = new Promise<void>(resolve => { releaseQuote = resolve; });
  await signedIn(page, { quoteGate });
  await page.goto('/checkout?step=shipping', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 30_000 });
  for (const [field, value] of Object.entries(shipping)) if (value) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await expect(page.getByRole('heading', { name: 'Delivery Method' })).toBeVisible();
  const loading = page.getByRole('status', { name: 'Loading delivery options' });
  await expect(loading).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Payment' })).toBeDisabled();
  await page.screenshot({ path: evidence('checkout-skeleton-delivery-1280'), fullPage: true });
  releaseQuote();
  await expect(page.getByRole('radio', { name: /Standard Delivery/ })).toBeVisible({ timeout: 10_000 });
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue to Payment' })).toBeEnabled();
});
