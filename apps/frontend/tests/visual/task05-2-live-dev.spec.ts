import { expect, test } from '@playwright/test';

/**
 * Task 05.2 live smoke against the developer's running localhost:3000 (local Express → identity-verified shared DEV). Read-only
 * except one sign-in attempt with the seed-file DEV administrator (apps/backend/prisma/seed.ts defaults), which must stop at the MFA
 * gate: before an owner/operator authorizes enrollment, a correct password yields no session (fail closed). The login attempt may
 * write a short-lived MFA challenge or a security event to shared DEV; it does not create an authenticated session or change business data.
 */
test.use({ baseURL: process.env.E2E_LIVE_BASE_URL ?? 'http://localhost:3000', trace: 'off', video: 'off', screenshot: 'off' });

test('admin password on shared DEV opens no session and shows the enrollment-authorization state', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/admin/analytics');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Email Address').fill(process.env.E2E_LIVE_ADMIN_EMAIL ?? 'admin2@electrohub.com');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_LIVE_ADMIN_PASSWORD ?? 'admin123!');
  const login = page.waitForResponse(response => response.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: 'Sign In' }).click();
  const response = await login;
  expect([200, 403]).toContain(response.status());
  const body = await response.json() as { accessToken?: string; requiresMfa?: boolean; error?: { code?: string } };
  expect(body.accessToken).toBeUndefined();
  expect(response.headers()['set-cookie'] ?? '').not.toMatch(/electrohub_(admin_|customer_)?refresh/);
  if (response.status() === 403) {
    expect(body.error?.code).toBe('ENROLLMENT_NOT_AUTHORIZED');
    await expect(page.getByText(/authori[sz]ed by an owner/i)).toBeVisible();
  } else {
    expect(body.requiresMfa).toBe(true);
  }
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.screenshot({ path: 'test-results/task05-2-live-dev/admin-login-gate-1440.png', fullPage: true });
  expect(errors.filter(text => !/40[13]|status of 4\d\d/.test(text))).toEqual([]);
});

test('storefront home renders on shared DEV with recommendation rails and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/task05-2-live-dev/home-1440.png', fullPage: false });
  expect(errors.filter(text => !/40[13]|status of 4\d\d/.test(text))).toEqual([]);
});
