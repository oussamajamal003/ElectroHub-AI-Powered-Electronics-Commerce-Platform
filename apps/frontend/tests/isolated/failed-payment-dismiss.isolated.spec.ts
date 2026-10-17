import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Task 03.6 — persistent failed-payment removal on the ISOLATED stack only (frontend :3200 -> backend :5200 -> disposable PostgreSQL).
 * Needs at least one Payment failed card per viewport for the generated fixture customer (disposable DB fixture, no Stripe intent).
 * Dismissal is a database-only write, so no PaymentIntent is ever created. Refuses any base URL other than the isolated frontend.
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://127.0.0.1:3200';
const credentialsFile = process.env.ISOLATED_FIXTURE_CREDENTIALS;
test.skip(!credentialsFile, 'Isolated fixture credentials are not configured.');
test.describe.configure({ mode: 'serial' });

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  test(`trash removes a failed payment and it stays removed after reload and sign-in (${viewport.width}px)`, async ({ page }) => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base)) throw new Error('Refusing: isolated frontend on :3200 only.');
    const credentials = Object.fromEntries(readFileSync(credentialsFile!, 'utf8').trim().split('\n').map(line => line.split('=')));
    const signIn = async () => {
      const login = await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } });
      expect(login.status()).toBe(200);
      return (await login.json()).accessToken as string;
    };
    await page.setViewportSize(viewport);
    const token = await signIn();
    // The backend behind this frontend accepts payment writes (disposable target), so no maintenance state can appear.
    expect((await (await page.request.get(`${base}/api/checkout/payment-capability`, { headers: { Authorization: `Bearer ${token}` } })).json())
      .data.paymentsEnabled).toBe(true);
    await page.goto(`${base}/cart`);
    await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible({ timeout: 30_000 });
    // No environment banner and no generic charge claim on a working stack.
    await expect(page.getByText(/switched off on this server|temporarily unavailable/)).toHaveCount(0);
    const card = page.locator('[data-purchase]').filter({ has: page.getByRole('button', { name: /^Remove failed payment for / }) }).first();
    const attemptId = await card.getAttribute('data-purchase');
    await expect(card.getByRole('link', { name: /Try Again/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const toast of await page.locator("[role=region] li, ol > li[data-state]").all()) {
      const box = await toast.boundingBox(); if (box) expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({ path: `test-results/isolated/dismiss-1-before-${viewport.width}.png`, fullPage: true });
    await card.getByRole('button', { name: /^Remove failed payment for / }).click();
    await expect(page.getByRole('heading', { name: 'Remove this failed payment?' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator(`[data-purchase="${attemptId}"]`)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/could not be removed|switched off on this server/)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your Cart' }).or(page.getByRole('heading', { name: /Cart/ })).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-purchase="${attemptId}"]`)).toHaveCount(0);
    await page.context().clearCookies();
    await signIn();
    await page.goto(`${base}/cart`);
    await expect(page.getByRole('heading', { name: /Cart/ }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-purchase="${attemptId}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/isolated/dismiss-2-after-${viewport.width}.png`, fullPage: true });
  });
}
