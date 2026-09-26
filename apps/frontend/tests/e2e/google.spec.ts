import { expect, test } from '@playwright/test';

const user = { id: 'oauth-browser-customer', email: 'oauth-browser@electrohub.invalid', firstName: 'Google', lastName: 'Customer', role: 'CUSTOMER' };

for (const scenario of ['success', 'linking_required', 'failure', 'cancelled']) {
  test(`Google OAuth ${scenario}`, async ({ page, context }) => {
    let authenticated = false;
    await context.route('**/api/auth/google/start**', async route => {
      const origin = new URL(route.request().url()).origin;
      await route.fulfill({ contentType: 'text/html', body: `<script>window.opener.postMessage({type:'electrohub-google',status:'${scenario}'},'${origin}');window.close();</script>` });
    });
    await page.route('**/api/auth/me', route => authenticated
      ? route.fulfill({ json: { user } }) : route.fulfill({ status: 401, json: { error: 'Unauthenticated' } }));
    await page.route('**/api/auth/refresh', route => authenticated
      ? route.fulfill({ json: { accessToken: 'test-browser-session' } }) : route.fulfill({ status: 401, json: { error: 'Unauthenticated' } }));
    await page.route('**/api/auth/google/link', async route => {
      expect(route.request().postDataJSON()).toEqual({ password: 'OwnershipPassword@123' });
      authenticated = true;
      await route.fulfill({ json: { accessToken: 'test-browser-session', user } });
    });
    await page.goto('/');
    if (await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible()) {
      await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Account' }).click();
    } else await page.getByRole('button', { name: 'Account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    if (scenario === 'success') authenticated = true;
    await dialog.getByRole('button', { name: 'Continue with Google' }).click();
    if (scenario === 'linking_required') {
      await expect(dialog.getByText(/An existing ElectroHub account/)).toBeVisible();
      await dialog.getByLabel('ElectroHub account password').fill('OwnershipPassword@123');
      await dialog.getByRole('button', { name: 'Connect Google' }).click();
    }
    if (scenario === 'success' || scenario === 'linking_required') await expect(dialog).not.toBeVisible();
    else {
      await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
      if (scenario === 'failure') await expect(dialog.getByText('Google sign-in could not be completed. Please try again.')).toBeVisible();
      else await expect(dialog.getByRole('alert')).toHaveCount(0);
    }
  });
}

test('register entry point starts the shared Google OAuth control', async ({ page, context }) => {
  await context.route('**/api/auth/google/start**', async route => {
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({ contentType: 'text/html', body: `<script>window.opener.postMessage({type:'electrohub-google',status:'cancelled'},'${origin}');window.close();</script>` });
  });
  await page.goto('/');
  if (await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible()) {
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Account' }).click();
  } else {
    const accountButton = page.getByRole('button', { name: 'Account', exact: true });
    if (await accountButton.count()) await accountButton.click();
    else {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await page.getByRole('navigation', { name: 'Mobile Navigation' }).getByRole('link', { name: 'Account' }).click();
    }
  }
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  const startRequest = context.waitForEvent('request', request => new URL(request.url()).pathname === '/api/auth/google/start');
  await dialog.getByRole('button', { name: 'Continue with Google' }).click();
  await startRequest;
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

test('customer password login remains functional', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible()) {
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Account' }).click();
  } else await page.getByRole('button', { name: 'Account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email Address').fill('customer@electrohub.com');
  await dialog.getByLabel('Password', { exact: true }).fill('customer123!');
  await dialog.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/account/);
  await expect(dialog).not.toBeVisible();
});

test('admin password login remains functional with no Google button', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill('admin@electrohub.com');
  await page.getByLabel('Password', { exact: true }).fill('admin123!');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
