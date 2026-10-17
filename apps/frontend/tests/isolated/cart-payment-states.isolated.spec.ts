import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Task 03.6 — Cart payment states on the ISOLATED stack only (frontend :3200 -> backend :5200 -> disposable PostgreSQL). Read-only: signs in
 * as the generated fixture customer and inspects /cart. Requires ISOLATED_FIXTURE_CREDENTIALS (path to the generated credentials file).
 * Never point this at shared DEV: it refuses any base URL other than the isolated frontend.
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://127.0.0.1:3200';
const credentialsFile = process.env.ISOLATED_FIXTURE_CREDENTIALS;
test.skip(!credentialsFile, 'Isolated fixture credentials are not configured.');

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  test(`cart shows only Processing and Payment failed after Place Order (${viewport.width}px)`, async ({ page }) => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base)) throw new Error('Refusing: isolated frontend on :3200 only.');
    const credentials = Object.fromEntries(readFileSync(credentialsFile!, 'utf8').trim().split('\n').map(line => line.split('=')));
    await page.setViewportSize(viewport);
    const login = await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } });
    expect(login.status()).toBe(200);
    await page.goto(`${base}/cart`);
    await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
    await expect(page.getByText('Processing', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check payment status' }).first()).toBeVisible();
    await expect(page.getByText('Payment failed', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Try Again/ }).first()).toBeVisible();
    // Every failed-payment card carries the trash icon (visible, not hover-only); a verified never-confirmed purchase offers Cancel purchase.
    await expect(page.getByRole('button', { name: /^Remove failed payment for / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Cancel purchase: / }).first()).toBeVisible();
    for (const removed of ['Incomplete purchases', 'Not completed', 'Restore items', 'Checkout saved', 'Continue to payment', 'closed before payment completed']) {
      await expect(page.getByText(removed)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/isolated/cart-payment-states-${viewport.width}.png`, fullPage: true });
  });
}
