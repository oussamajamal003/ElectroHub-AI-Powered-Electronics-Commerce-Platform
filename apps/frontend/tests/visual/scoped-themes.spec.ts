import { expect, test } from '@playwright/test';
import { installDarkModeApi } from './darkMode.fixtures';

test('same-browser customer/admin tabs persist and synchronise only their own theme', async ({ context, page }, info) => {
  test.slow(); // Four live tabs on a cold Vite dev server take ~110 s in WebKit.
  const admin = await context.newPage();
  const customerPeer = await context.newPage();
  const adminPeer = await context.newPage();
  for (const tab of [page, admin, customerPeer, adminPeer]) {
    await installDarkModeApi(tab, { customer: true, admin: true });
    await tab.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  }
  await page.goto('/products');
  await admin.goto('/admin/profile');
  await customerPeer.goto('/contact');
  await adminPeer.goto('/admin/inventory');
  const check = async (customer: string, administrator: string) => {
    for (const tab of [page, customerPeer]) await expect(tab.locator('html')).toHaveAttribute('data-theme', customer);
    for (const tab of [admin, adminPeer]) await expect(tab.locator('html')).toHaveAttribute('data-theme', administrator);
  };
  await check('light', 'light');
  await page.screenshot({ path: info.outputPath('customer-light-admin-light.png') });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await check('dark', 'light');
  await page.screenshot({ path: info.outputPath('customer-dark.png') });
  await admin.screenshot({ path: info.outputPath('admin-light.png') });
  await admin.getByRole('button', { name: 'Switch to dark mode' }).click();
  await check('dark', 'dark');
  await admin.screenshot({ path: info.outputPath('admin-dark.png') });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await check('light', 'dark');
  await page.screenshot({ path: info.outputPath('customer-light-admin-dark.png') });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await admin.getByRole('button', { name: 'Switch to light mode' }).click();
  await check('dark', 'light');
  await Promise.all([page.reload(), admin.reload()]);
  await check('dark', 'light');
  // Before React executes, the blocking script must already select the admin scope.
  await admin.route('**/src/main.tsx*', async route => { await new Promise(resolve => setTimeout(resolve, 1000)); await route.continue(); });
  await admin.goto('/admin/login', { waitUntil: 'commit' });
  await expect(admin.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  // Real BrowserRouter POP navigation in the same document; preferences never get copied across scopes.
  await page.evaluate(() => { history.pushState({}, '', '/admin/profile'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => { history.pushState({}, '', '/products'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const secondContext = await context.browser()!.newContext({ colorScheme: 'light' });
  const isolated = await secondContext.newPage();
  await installDarkModeApi(isolated);
  await isolated.goto('/products');
  await expect(isolated.locator('html')).toHaveAttribute('data-theme', 'light');
  await secondContext.close();
});
