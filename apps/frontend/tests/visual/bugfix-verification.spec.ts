import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SHOTS = 'screenshots/verification';

const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

for (const vp of viewports) {
  test.describe(`Products Page Verification (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });

    test(`hides Deletion test item and renders correct results at ${vp.width}px`, async ({ page }) => {
      await page.goto(`${BASE}/products`);
      await page.waitForLoadState('domcontentloaded');

      // Assert test product is completely absent
      await expect(page.getByText('Deletion test item')).toHaveCount(0);
      await expect(page.getByText('Delete 23e7708b')).toHaveCount(0);

      // Assert results region and count are visible and accurate
      await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('status').filter({ hasText: /results/ })).toBeVisible({ timeout: 15000 });

      // Screenshot for verification
      await page.screenshot({ path: `${SHOTS}/products-${vp.name}.png`, fullPage: false });
    });
  });
}

test.describe('Direct Test Product Route Handling', () => {
  test('direct navigation to test product slug renders Product unavailable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/products/deletion-test-23e7708b-434a-4e34-beb5-cb69fdb3a00d`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: 'Product unavailable' })).toBeVisible();
    await expect(page.getByText('Deletion test item')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/direct-test-product-blocked.png` });
  });
});

test.describe('Header Auth Hydration Verification', () => {
  for (const vp of viewports) {
    test(`header renders immediately without "Restoring your session…" at ${vp.name}`, async ({ page, context }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.route('**/api/auth/refresh', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accessToken: 'test-token' }),
        });
      });
      await page.route('**/api/auth/me', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              id: 'user-123',
              email: 'alex@example.com',
              firstName: 'Alex',
              lastName: 'Morgan',
              role: 'CUSTOMER',
            },
          }),
        });
      });

      // Pre-seed authenticated user in localStorage
      await context.addInitScript(() => {
        localStorage.setItem('electrohub:header-identity', JSON.stringify({ firstName: 'Alex', lastName: 'Morgan' }));
        localStorage.setItem('electrohub:cached-user', JSON.stringify({
          id: 'user-123',
          email: 'alex@example.com',
          firstName: 'Alex',
          lastName: 'Morgan',
          role: 'CUSTOMER'
        }));
      });

      await page.goto(`${BASE}/products`);
      await page.waitForLoadState('domcontentloaded');

      // Verify normal ElectroHub logo and banner are visible immediately
      const header = page.locator('header[role="banner"]');
      await expect(header).toBeVisible();
      await expect(page.getByLabel('ElectroHub — Home')).toBeVisible();

      // Verify "Restoring your session…" is NEVER shown
      await expect(page.getByText('Restoring your session…')).toHaveCount(0);
      await expect(page.getByTestId('auth-hydration-header')).toHaveCount(0);

      // Verify user avatar AM appears immediately without guest login flash
      await expect(header.getByText('AM', { exact: true })).toBeVisible();
      await expect(header.getByRole('button', { name: 'Login' })).toHaveCount(0);

      await header.screenshot({ path: `${SHOTS}/header-auth-${vp.name}.png` });
    });
  }
});
