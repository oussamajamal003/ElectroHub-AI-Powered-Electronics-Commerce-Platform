import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { attemptId, fillShipping, harness } from './stripe.harness';
import { routeSavedPurchases, savedPurchase } from './saved-purchases';

// Frontend-only loading baseline. Every API and the Stripe SDK are intercepted, so these numbers
// describe the application's own request choreography and rendering, NOT backend or Stripe latency.
// A fixed per-request delay is injected to expose how many requests each screen issues in sequence:
// (time at 400 ms - time at 0 ms) / 400 ms ~= sequential request depth.
const DELAY_MS = 400;
const results: Record<string, unknown>[] = [];

async function instrument(page: Page, delayMs: number) {
  await page.addInitScript(() => {
    const state = { cls: 0, skeletonShows: 0 };
    Reflect.set(window, '__baseline', state);
    new PerformanceObserver(list => { for (const entry of list.getEntries()) {
      if (!Reflect.get(entry, 'hadRecentInput')) state.cls += Number(Reflect.get(entry, 'value') ?? 0); } }).observe({ type: 'layout-shift', buffered: true });
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLElement && (node.matches('[data-testid="cart-skeleton"]') || node.querySelector('[data-testid="cart-skeleton"]'))) state.skeletonShows++; } })
      .observe(document, { childList: true, subtree: true });
  });
  const api = await harness(page);
  if (delayMs) await page.route('**/api/**', async route => { await new Promise(resolve => setTimeout(resolve, delayMs)); await route.fallback(); });
  return api;
}
const read = (page: Page) => page.evaluate(() => ({ ...(Reflect.get(window, '__baseline') as { cls: number; skeletonShows: number }), now: performance.now(),
  marks: performance.getEntriesByType('mark').filter(mark => mark.name.startsWith('electrohub.payment.')).map(mark => ({ name: mark.name.slice(19), at: mark.startTime })) }));
const count = (api: { requests: { method: string; path: string }[] }, method: string, path: string) => api.requests.filter(request => request.method === method && request.path === path).length;
const round = (value: number) => Math.round(value);

test.afterAll(() => {
  mkdirSync('test-results/checkout', { recursive: true });
  writeFileSync('test-results/checkout/loading-baseline.json', JSON.stringify(results, null, 2));
});

for (const delayMs of [0, DELAY_MS]) {
  test(`cart: cold load and client-side return, ${delayMs} ms per request`, async ({ page }) => {
    const api = await instrument(page, delayMs);
    // Warm the dev server first: the measured load is a fresh document with empty app state, not a Vite compile.
    await page.goto('/cart'); await expect(page.getByRole('heading', { name: 'Apple iPhone 15 Pro' })).toBeVisible({ timeout: 45_000 });
    api.requests.length = 0;
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Apple iPhone 15 Pro' })).toBeVisible();
    const cold = await read(page);
    const coldRequests = { auth: api.requests.filter(request => request.path.startsWith('/api/auth/')).length, cart: count(api, 'GET', '/api/cart'), purchases: count(api, 'GET', '/api/checkout/payment-attempts') };
    await page.getByRole('link', { name: 'Continue shopping' }).click();
    await expect(page).toHaveURL(/\/products$/);
    const before = api.requests.length; const leftAt = (await read(page)).now;
    await page.getByRole('link', { name: /^Cart/ }).click();
    await expect(page.getByRole('heading', { name: 'Apple iPhone 15 Pro' })).toBeVisible();
    const warm = await read(page);
    results.push({ screen: 'cart', delayMs, coldUsefulContentMs: round(cold.now), coldRequests, coldLayoutShift: Number(cold.cls.toFixed(4)),
      coldSkeletonShows: cold.skeletonShows, warmReturnMs: round(warm.now - leftAt), warmSkeletonShows: warm.skeletonShows - cold.skeletonShows,
      warmCartRequests: api.requests.slice(before).filter(request => request.path === '/api/cart').length });
    // One authoritative Cart read per cold navigation, and a warm return never falls back to the skeleton.
    expect(coldRequests.cart).toBe(1);
    expect(warm.skeletonShows - cold.skeletonShows).toBe(0);
  });

  test(`checkout: payment inputs ready and order acknowledgement, ${delayMs} ms per request`, async ({ page }) => {
    const api = await instrument(page, delayMs);
    await page.goto('/checkout'); await expect(page.locator('#shipping-recipient')).toBeVisible({ timeout: 45_000 });
    api.requests.length = 0;
    await page.reload();
    await expect(page.locator('#shipping-recipient')).toBeVisible();
    const shell = await read(page);
    await fillShipping(page); await page.getByRole('radio', { name: /Express Delivery/ }).check();
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    // Usable means the provider reported ready and the step action is enabled, not that the parent mounted.
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    const ready = await read(page);
    const mark = (name: string) => ready.marks.find(entry => entry.name === name)?.at;
    const entered = mark('payment-step-entered'); const elementReady = mark('payment-element-ready');
    const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
    await frame.getByLabel('Mock card number').fill('4242424242424242'); await frame.getByLabel('Mock expiry').fill('1230'); await frame.getByLabel('Mock security code').fill('123');
    await page.getByRole('button', { name: 'Review Order' }).click();
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
    const clickedAt = (await read(page)).now;
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect(page.getByRole('heading', { name: 'Processing your order…' })).toBeVisible();
    const acknowledged = await read(page);
    await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible();
    const confirmed = await read(page);
    const setupPosts = count(api, 'POST', '/api/checkout/payment-attempts');
    // Real provider mounts from the SDK fixture; React effect marks double-fire under StrictMode and are not mounts.
    const provider = await page.evaluate(() => { const fixture = Reflect.get(window, '__stripeFixture') as { mounts: number; unmounts: number }; return { mounts: fixture.mounts, unmounts: fixture.unmounts }; });
    const elementMounts = provider.mounts;
    results.push({ screen: 'checkout', delayMs, shellUsableMs: round(shell.now), shellLayoutShift: Number(shell.cls.toFixed(4)),
      paymentStepToInputsReadyMs: entered !== undefined && elementReady !== undefined ? round(elementReady - entered) : null,
      setupPosts, elementMounts, elementUnmounts: provider.unmounts, paymentStepLayoutShift: Number((ready.cls - shell.cls).toFixed(4)),
      placeOrderToProcessingMs: round(acknowledged.now - clickedAt), placeOrderToConfirmedMs: round(confirmed.now - clickedAt),
      submitPosts: api.requests.filter(request => request.path.endsWith('/submit')).length, providerConfirms: await api.confirms().catch(() => null) });
    // Identity is stable across legitimate re-renders: one setup request and one secure-entry mount.
    expect(setupPosts).toBe(1);
    expect(elementMounts).toBe(1);
    expect(api.requests.filter(request => request.path.endsWith('/submit'))).toHaveLength(1);
  });
}

/** Scenario 1: retry starts from a Failed payments card and opens Checkout's Payment step for that saved purchase. */
async function openSavedRetry(page: Page) {
  await routeSavedPurchases(page, () => [savedPurchase({ state: 'DECLINED', classification: 'DECLINED', pending: false, retryAllowed: true })]);
  await page.goto('/cart');
  await page.locator(`article[data-purchase="${attemptId}"]`).getByRole('link', { name: /^Try Again/ }).click({ timeout: 45_000 });
}

test('saved-purchase retry: one resume request under StrictMode and time to secure entry', async ({ page }) => {
  const api = await instrument(page, DELAY_MS);
  await openSavedRetry(page); await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled({ timeout: 45_000 });
  api.requests.length = 0;
  await page.reload(); // router state keeps the purchase identity across reload; the backend re-verifies it
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  const ready = await read(page);
  const resumePosts = api.requests.filter(request => request.path.endsWith('/resume')).length;
  results.push({ screen: 'retry', delayMs: DELAY_MS, secureEntryReadyMs: round(ready.now), resumePosts, layoutShift: Number(ready.cls.toFixed(4)) });
  expect(resumePosts).toBe(1);
  expect(api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts')).toHaveLength(0);
});

for (const width of [390, 1440]) {
  test(`saved-purchase retry: unreachable and refused states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await instrument(page, 0);
    let status = 503;
    await page.route(`**/api/checkout/payment-attempts/${attemptId}/resume`, route => route.fulfill({ status,
      json: { error: { code: status === 503 ? 'PAYMENT_UNAVAILABLE' : 'PAYMENT_RECOVERY_PENDING', message: 'intercepted' } } }));
    await openSavedRetry(page);
    await expect(page.getByRole('heading', { name: 'We couldn’t load this saved purchase' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Nothing was charged');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(/failed|declined/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Pay|Review Order|Place Order/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
    // Keyboard reachability of the recovery action and no horizontal overflow on the narrow layout.
    const again = page.getByRole('button', { name: 'Try again' });
    await again.focus(); await expect(again).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `screenshots/scenario1-final/retry-unreachable-${width}.png`, fullPage: true });
    status = 409;
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'This purchase can’t be paid again right now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Return to Cart' })).toBeVisible();
    await page.screenshot({ path: `screenshots/scenario1-final/retry-refused-${width}.png`, fullPage: true });
  });
}
