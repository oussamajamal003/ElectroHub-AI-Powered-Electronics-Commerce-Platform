import { expect, test, type Page } from '@playwright/test';
import { fillCard, harness, review } from './stripe.harness';

const placeOrder = (page: Page) => page.getByRole('button', { name: /Place Order/ });
const setupPosts = (api: Awaited<ReturnType<typeof harness>>) => api.requests.filter(value => value.method === 'POST' && value.path === '/api/checkout/payment-attempts');

/** Refresh on Review: card entry and client secret are memory-only, so Review is never restored with a dead Place Order. */
for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`refresh on Review returns to card entry, reuses the attempt and re-enables Place Order at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const api = await harness(page);
    await page.goto('/checkout');
    await review(page);
    await expect(placeOrder(page)).toBeEnabled();
    const first = setupPosts(api)[0];
    let delay = 3000;
    // Slow secure setup after reload: Review must not appear (with a disabled button) while it is pending.
    await page.route('**/api/checkout/payment-attempts', async route => {
      if (route.request().method() === 'POST' && delay) await new Promise(resolve => setTimeout(resolve, delay));
      await route.fallback();
    });
    for (let round = 0; round < 3; round++) {
      await page.reload();
      for (const wait of [600, 1200, 1200]) { await page.waitForTimeout(wait); await expect(placeOrder(page)).toHaveCount(0); }
      await expect(page).toHaveURL(/step=payment/);
      await expect(page.getByText(/card details are not kept/)).toBeVisible();
      await expect.poll(() => setupPosts(api).length, { timeout: 15000 }).toBeGreaterThan(round + 1);
      await expect(page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]').getByLabel('Mock card number')).toBeVisible({ timeout: 15000 });
      delay = round === 0 ? 0 : 3000;
    }
    // Every replay carries the original idempotency key and request: one PaymentIntent, never a new attempt.
    for (const post of setupPosts(api)) expect(post.key).toBe(first.key);
    expect(api.requests.filter(value => value.path.endsWith('/submit'))).toHaveLength(0);
    await expect(placeOrder(page)).toHaveCount(0);
    // Without re-entered card details Review cannot be reached, so Place Order cannot be enabled by the restored draft.
    await page.getByRole('button', { name: 'Review Order' }).click();
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toHaveCount(0);
    await expect(placeOrder(page)).toHaveCount(0);
    await fillCard(page);
    await page.getByRole('button', { name: 'Review Order' }).click();
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
    await expect(placeOrder(page)).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/checkout/review-refresh-${viewport.width}-review.png` });
  });
}
