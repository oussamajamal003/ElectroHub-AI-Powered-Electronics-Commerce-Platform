import { expect, test } from '@playwright/test';

// Rejected requests only: no session, credentials, database or authentication bypass.
test.beforeEach(async ({ page }) => {
  await page.route(/^http:\/\/localhost:3200\/api\//, route => route.fulfill({ status: 401,
    contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid credentials' } }) }));
  await page.goto('/admin/login');
});

for (const width of [390, 768, 1440]) {
  test(`Sign In remains keyboard reachable after validation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const button = page.getByRole('button', { name: 'Sign In', exact: true });
    await page.getByLabel('Email Address').focus();
    await page.keyboard.press('Tab'); // password
    await page.keyboard.press('Tab'); // visibility
    await page.keyboard.press('Tab'); // submit
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Email address is required.')).toBeVisible();
    await expect(button).toBeEnabled();
    await page.getByLabel('Password', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByText('Password is required.')).toBeVisible();
  });
}

test('Sign In Enter and Space send one request and retain focus after rejection', async ({ page }) => {
  let requests = 0;
  let release = () => {};
  await page.route('**/api/auth/login', async route => {
    requests++;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Invalid credentials' } }) });
  });
  await page.getByLabel('Email Address').focus();
  await page.keyboard.type('keyboard@qa.invalid');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Synthetic-invalid-password');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const button = page.getByRole('button', { name: 'Sign In', exact: true });
  await expect(button).toBeFocused();
  for (const key of ['Enter', 'Space']) {
    const before = requests;
    await page.keyboard.press(key);
    await expect.poll(() => requests).toBe(before + 1);
    await expect(page.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    expect(requests).toBe(before + 1);
    release();
    await expect(button).toBeEnabled();
    await expect(page.getByText('Invalid credentials', { exact: true })).toBeVisible();
    await expect(button).toBeFocused();
  }
  await page.screenshot({ path: 'test-results/auth-keyboard/admin-signin-keyboard.png' });
});

test('Start again stays next to the active MFA action', async ({ page }) => {
  // Synthetic restricted challenge for layout only; no authenticated session is issued.
  await page.route('**/api/auth/login', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ requiresMfa: true,
      mfaToken: 'synthetic-layout-only', expiresAt: new Date(Date.now() + 300_000).toISOString(),
      factors: { totp: true, passkey: true, recoveryCode: true }, enrollmentRequired: false }) }));
  await page.getByLabel('Email Address').fill('keyboard@qa.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-invalid-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const method of ['Authenticator app', 'Passkey', 'Recovery code']) {
      await page.getByRole('tab', { name: method, exact: true }).focus();
      await page.keyboard.press('Enter');
      const action = page.getByRole('tabpanel').getByRole('button', { name: /Verify and sign in|Use passkey/ });
      const actionBox = await action.boundingBox();
      const restartBox = await page.getByRole('button', { name: 'Start again' }).boundingBox();
      expect(actionBox).not.toBeNull(); expect(restartBox).not.toBeNull();
      expect(restartBox!.y - (actionBox!.y + actionBox!.height)).toBeLessThanOrEqual(24);
      expect(await page.locator('[role="tabpanel"][hidden]').evaluateAll(panels =>
        panels.every(panel => panel.getBoundingClientRect().height === 0))).toBe(true);
    }
    await page.screenshot({ path: `test-results/auth-keyboard/mfa-compact-actions-${width}.png` });
  }
});
