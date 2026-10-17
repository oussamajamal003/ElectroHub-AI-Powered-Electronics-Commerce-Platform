import { expect, test, type Page } from '@playwright/test';
import { fillShipping, harness } from './stripe.harness';

// INTERCEPTED APIs and Stripe SDK fixture (real Chromium, real app). Proves UI transitions only.
// Real Payment Element readiness measured on this machine's network: 24.1, 27.9 and 30.4 s (cold cache).
test.beforeAll(async ({ browser }) => { const warm = await browser.newPage(); await warm.goto('/checkout', { timeout: 60_000 }); await warm.close(); });

async function openPayment(page: Page, readyDelayMs: number | null | undefined, options: { loadError?: boolean; holdSetup?: Promise<void> } = {}) {
  await page.clock.install();
  const api = await harness(page);
  await page.addInitScript(([delay, loadError]) => { const fixture = Reflect.get(window, '__stripeFixture'); Reflect.set(fixture, 'readyDelayMs', delay === -1 ? undefined : delay); Reflect.set(fixture, 'loadError', loadError); }, [readyDelayMs === undefined ? -1 : readyDelayMs, Boolean(options.loadError)] as const);
  if (options.holdSetup) {
    const held = options.holdSetup;
    await page.route('**/api/checkout/payment-attempts', async route => { if (route.request().method() === 'POST') await held; return route.fallback(); });
  }
  await page.goto('/checkout'); await fillShipping(page);
  await page.getByRole('radio', { name: /Express Delivery/ }).check();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
  if (!options.holdSetup) await page.waitForFunction(() => (document.querySelector('iframe[title^="Mock hosted"]') as HTMLIFrameElement | null)?.contentDocument?.readyState === 'complete');
  const setups = () => api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts').length;
  const mounts = () => page.evaluate(() => (Reflect.get(window, '__stripeFixture') as { mounts: number }).mounts);
  return { api, setups, mounts };
}
const review = (page: Page) => page.getByRole('button', { name: 'Review Order' });

test('a slow but healthy provider load is shown as slow, then becomes usable without any retry', async ({ page }) => {
  const { setups, mounts } = await openPayment(page, 31_000);
  await page.clock.runFor(25_001);
  await expect(page.getByText(/taking longer than usual/)).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(review(page)).toBeDisabled();
  await page.clock.runFor(6_000);
  await expect(review(page)).toBeEnabled();
  await expect(page.getByText(/taking longer than usual/)).toHaveCount(0);
  expect(setups()).toBe(1); expect(await mounts()).toBe(1);
});

test('a provider stall ends in an actionable error whose retry reuses the same payment setup', async ({ page }) => {
  const { setups, mounts } = await openPayment(page, null);
  await page.clock.runFor(90_001);
  await expect(page.getByRole('alert')).toContainText('Secure card entry has not finished loading.'); await expect(page.getByText('Secure card entry is unavailable.')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toHaveCount(0);
  await expect(review(page)).toBeDisabled();
  await page.evaluate(() => { Reflect.set(Reflect.get(window, '__stripeFixture'), 'readyDelayMs', undefined); });
  await page.getByRole('button', { name: 'Retry secure entry' }).click();
  await expect(review(page)).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(setups()).toBe(1); // no new payment setup request, no replacement attempt
  expect(await mounts()).toBe(2);
});

test('Reload secure entry from the slow notice remounts the same secret without a setup request', async ({ page }) => {
  const { setups, mounts } = await openPayment(page, null);
  await page.clock.runFor(25_001);
  await page.evaluate(() => { Reflect.set(Reflect.get(window, '__stripeFixture'), 'readyDelayMs', undefined); });
  await page.getByRole('button', { name: 'Reload secure entry' }).click();
  await expect(review(page)).toBeEnabled();
  expect(setups()).toBe(1); expect(await mounts()).toBe(2);
  const secrets = await page.evaluate(() => (Reflect.get(window, '__stripeFixture') as { clientSecrets: string[] }).clientSecrets);
  expect(new Set(secrets).size).toBe(1);
});

for (const readyAtMs of [30_000, 60_000, 89_000]) {
  test(`provider ready at ${readyAtMs / 1000} s: no false unavailable error, then usable`, async ({ page }) => {
    const { setups, mounts } = await openPayment(page, readyAtMs);
    await page.clock.runFor(readyAtMs - 1_000);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(review(page)).toBeDisabled();
    await page.clock.runFor(1_500);
    await expect(review(page)).toBeEnabled();
    await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toHaveCount(0);
    await expect(page.getByText(/taking longer than usual/)).toHaveCount(0);
    expect(setups()).toBe(1); expect(await mounts()).toBe(1);
  });
}

test('a slow payment setup keeps the skeleton with a truthful notice and no retry, then card entry loads', async ({ page }) => {
  let release!: () => void; const holdSetup = new Promise<void>(resolve => { release = resolve; });
  await page.clock.install();
  const api = await harness(page);
  await page.route('**/api/checkout/payment-attempts', async route => { if (route.request().method() === 'POST') await holdSetup; return route.fallback(); });
  await page.goto('/checkout'); await fillShipping(page);
  await page.getByRole('radio', { name: /Express Delivery/ }).check();
  const setupSent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/checkout/payment-attempts');
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await setupSent;
  await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
  await page.clock.runFor(25_001);
  await expect(page.getByText(/Preparing secure payment is taking longer than usual/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Retry|Reload/ })).toHaveCount(0);
  await expect(review(page)).toBeDisabled();
  release();
  await expect(review(page)).toBeEnabled();
  await expect(page.getByText(/taking longer than usual/)).toHaveCount(0);
  expect(api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts')).toHaveLength(1);
});

test('an explicit provider load error is distinguished from slowness and retries the same saved attempt', async ({ page }) => {
  const { api, setups } = await openPayment(page, undefined, { loadError: true });
  await expect(page.getByRole('alert')).toContainText('Secure card entry is unavailable.');
  await expect(page.getByText(/taking longer than usual/)).toHaveCount(0);
  await expect(review(page)).toBeDisabled();
  expect(setups()).toBe(1);
  await page.evaluate(() => { Reflect.set(Reflect.get(window, '__stripeFixture'), 'loadError', false); });
  await page.getByRole('button', { name: 'Retry secure entry' }).click();
  await expect(review(page)).toBeEnabled();
  // A provider-reported error goes back through setup, which replays the SAME saved attempt key (no replacement attempt).
  const keys = api.requests.filter(request => request.method === 'POST' && request.path === '/api/checkout/payment-attempts').map(request => request.key);
  expect(keys.length).toBe(2); expect(new Set(keys).size).toBe(1);
});

for (const width of [390, 768, 1440, 1920]) {
  test(`setup-slow and provider load-error states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await harness(page);
    let release!: () => void; const holdSetup = new Promise<void>(resolve => { release = resolve; });
    await page.addInitScript(() => { Reflect.set(Reflect.get(window, '__stripeFixture'), 'loadError', true); });
    await page.route('**/api/checkout/payment-attempts', async route => { if (route.request().method() === 'POST') await holdSetup; return route.fallback(); });
    await page.goto('/checkout'); await fillShipping(page);
    await page.getByRole('radio', { name: /Express Delivery/ }).check();
    const setupSent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/checkout/payment-attempts');
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await setupSent;
    await page.clock.runFor(25_001);
    await expect(page.getByText(/Preparing secure payment is taking longer than usual/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/checkout/secure-entry-setup-slow-${width}.png`, fullPage: true });
    release();
    await expect(page.getByRole('alert')).toContainText('Secure card entry is unavailable.');
    const retry = page.getByRole('button', { name: 'Retry secure entry' }); await retry.focus(); await expect(retry).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/checkout/secure-entry-load-error-${width}.png`, fullPage: true });
  });
}

for (const width of [390, 768, 1440, 1920]) {
  test(`secure entry states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPayment(page, null);
    await page.screenshot({ path: `test-results/checkout/secure-entry-skeleton-${width}.png`, fullPage: true });
    await page.clock.runFor(25_001);
    await expect(page.getByText(/taking longer than usual/)).toBeVisible();
    const reload = page.getByRole('button', { name: 'Reload secure entry' }); await reload.focus(); await expect(reload).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/checkout/secure-entry-slow-${width}.png`, fullPage: true });
    await page.clock.runFor(65_000);
    await expect(page.getByRole('alert')).toContainText('Secure card entry has not finished loading.'); await expect(page.getByText('Secure card entry is unavailable.')).toHaveCount(0);
    await page.screenshot({ path: `test-results/checkout/secure-entry-stalled-${width}.png`, fullPage: true });
    await page.evaluate(() => { Reflect.set(Reflect.get(window, '__stripeFixture'), 'readyDelayMs', undefined); });
    await page.getByRole('button', { name: 'Retry secure entry' }).click();
    await expect(review(page)).toBeEnabled();
    await page.screenshot({ path: `test-results/checkout/secure-entry-ready-${width}.png`, fullPage: true });
  });
}
