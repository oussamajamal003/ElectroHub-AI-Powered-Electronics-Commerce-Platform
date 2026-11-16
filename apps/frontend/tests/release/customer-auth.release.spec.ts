import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, request, test } from '@playwright/test';
import { accountMenu, apiOrigin, customerApi, distinctClientAddress, openAccountDialog, releaseHome, shopper, signInCustomer, slot,
  supportToken } from './support';

/**
 * Registration/login journeys on the real stack: UI registration with an emailed OTP captured by the backend's local outbox (no email
 * provider), invalid credentials, required-field validation, logout, refresh persistence, protected-route handling and customer/admin
 * separation (UI and API). Synthetic `e2e-…@electrohub.invalid` accounts are removed by the test-only cleanup endpoint.
 */
const runId = randomUUID();

async function capturedCode(subject: string, email: string): Promise<string> {
  const file = createHash('sha256').update(`${email}:${subject}`).digest('hex');
  try {
    const record = JSON.parse(await readFile(path.join(releaseHome, 'outbox', `${file}.json`), 'utf8')) as { textContent: string };
    return record.textContent.match(/\b\d{6}\b/)?.[0] ?? '';
  } catch { return ''; }
}

test.describe('customer authentication', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  test.afterAll(async () => {
    const api = await request.newContext({ baseURL: apiOrigin });
    const response = await api.post('/api/__e2e/cleanup', { headers: { 'x-e2e-test-support-token': supportToken }, data: { runId } });
    expect(response.status()).toBe(200);
    await api.dispose();
  });

  test('registers through the UI, rejects a wrong OTP, verifies with the emailed code and is signed in', async ({ page }, testInfo) => {
    const email = `e2e-rel-${runId}-${slot(testInfo)}@electrohub.invalid`;
    await page.goto('/');
    const dialog = await openAccountDialog(page);
    await dialog.getByRole('button', { name: 'Register' }).click();
    // Required-field validation blocks submission before any request is made.
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog.getByRole('button', { name: 'Create Account' })).toBeVisible();
    await expect(dialog.getByText('Enter the 6-digit code', { exact: false })).toHaveCount(0);

    await dialog.getByLabel('Full Name').fill('Release Customer');
    await dialog.getByLabel('Email Address').fill(email);
    await dialog.getByLabel('Password', { exact: true }).fill('ReleasePass#2026');
    await dialog.getByLabel('Confirm Password').fill('ReleasePass#2026');
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    const inputs = dialog.getByRole('group', { name: 'Verification code' }).getByRole('textbox');
    await expect(inputs.first()).toBeVisible();

    for (const [index, digit] of [...'000000'].entries()) await inputs.nth(index).fill(digit);
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Incorrect verification code. Please try again.');

    await expect.poll(() => capturedCode('Verify your ElectroHub account', email)).toMatch(/^\d{6}$/);
    const code = await capturedCode('Verify your ElectroHub account', email);
    for (const [index, digit] of [...code].entries()) await inputs.nth(index).fill(digit);
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText(email).first()).toBeVisible();
    // The OTP is single-use.
    expect((await page.request.post('/api/auth/verify-email', { data: { email, code } })).status()).toBe(400);
    // The account is a CUSTOMER: the administrator API refuses it.
    const api = await customerApi(email, 'ReleasePass#2026', '198.51.100.240');
    expect([401, 403]).toContain((await api.get('/api/admin/dashboard')).status());
    await api.dispose();
  });

  test('rejects invalid credentials with a generic message and keeps the visitor signed out', async ({ page }, testInfo) => {
    await page.goto('/');
    const dialog = await openAccountDialog(page);
    await dialog.getByRole('textbox', { name: 'Email Address' }).fill(shopper(testInfo, 'auth').email);
    await dialog.getByLabel('Password', { exact: true }).fill('Definitely-Wrong-9');
    await dialog.getByRole('button', { name: 'Login' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('alert')).not.toContainText(/prisma|stack|sql|bcrypt/i);
    // Unknown and known accounts are indistinguishable.
    const known = await dialog.getByRole('alert').innerText();
    await dialog.getByRole('textbox', { name: 'Email Address' }).fill(`nobody-${runId}@release.invalid`);
    await dialog.getByRole('button', { name: 'Login' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(known);
    await expect(dialog).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });

  test('a signed-in session survives reload, reaches protected pages, and logout ends it server-side', async ({ page }, testInfo) => {
    await page.goto('/');
    await signInCustomer(page, shopper(testInfo, 'auth').email);
    await page.goto('/orders');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Orders/);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Orders/);
    await expect(page.getByRole('link', { name: shopper(testInfo, 'auth').orderReference }).or(page.getByText(shopper(testInfo, 'auth').orderReference)).first()).toBeVisible();

    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    // Sign-out asks for confirmation; Cancel keeps the session.
    const confirm = page.getByRole('dialog', { name: 'Sign Out' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(accountMenu(page)).toBeVisible();
    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    await confirm.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
    // The refresh cookie was revoked: a reload does not restore the session and protected data is refused.
    await page.goto('/orders');
    await expect(page.getByText(shopper(testInfo, 'auth').orderReference)).toHaveCount(0);
    expect((await page.request.post('/api/auth/customer/refresh')).status()).toBe(401);
  });

  test('a customer session cannot open the admin console and customer tokens are refused by admin APIs', async ({ page }, testInfo) => {
    await page.goto('/');
    await signInCustomer(page, shopper(testInfo, 'auth').email);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    const api = await customerApi(shopper(testInfo, 'auth').email);
    for (const endpoint of ['/api/admin/dashboard', '/api/admin/orders', '/api/admin/products', '/api/admin/settings/store']) {
      expect([401, 403], endpoint).toContain((await api.get(endpoint)).status());
    }
    await api.dispose();
  });

  test('there is no public administrator registration route', async ({ page }) => {
    await page.goto('/admin/register');
    await expect(page.getByRole('button', { name: 'Create Account' })).toHaveCount(0);
    const api = await request.newContext({ baseURL: apiOrigin });
    expect([404, 405]).toContain((await api.post('/api/auth/admin/register', { data: {} })).status());
    await api.dispose();
  });
});
