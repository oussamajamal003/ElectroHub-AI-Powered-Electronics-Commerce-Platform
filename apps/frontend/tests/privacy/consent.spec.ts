import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
});

test('reject persists and settings can be reopened without analytics requests', async ({ page }) => {
  const events: string[] = [];
  page.on('request', request => { if (/\/api\/(analytics\/events|recommendations\/events)/.test(request.url())) events.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reject optional' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('eh.storefront-session'))).toBeNull();
  await page.getByRole('button', { name: 'Reject optional' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reject optional' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cookie Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Cookie Settings' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
  expect(events).toEqual([]);
});

test('accept and withdraw update the tab identifier', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('eh.storefront-session'))).not.toBeNull();
  await page.getByRole('button', { name: 'Cookie Settings' }).click();
  await expect(page.getByRole('checkbox', { name: 'Analytics' })).toBeChecked();
  await page.getByRole('button', { name: 'Reject optional' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('eh.storefront-session'))).toBeNull();
});

test('banner controls fit representative viewports', async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Cookie preferences' });
    await expect(banner).toBeVisible();
    for (const name of ['Accept all', 'Reject optional', 'Customize']) await expect(banner.getByRole('button', { name })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`banner-${width}.png`) });
  }
});
