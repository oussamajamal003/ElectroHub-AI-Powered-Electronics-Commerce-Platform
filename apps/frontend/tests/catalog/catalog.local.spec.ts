import { expect, test } from '@playwright/test';

test.skip(!process.env.CATALOG_REAL_LOCAL, 'Requires the real local API and catalog data');

test('real customer catalog, guest Orders, and responsive layout', async ({ page }) => {
  test.setTimeout(240_000);
  const unexpectedServerErrors: string[] = [];
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 500) unexpectedServerErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/');

  // Verify top delivery strip is completely absent
  await expect(page.getByRole('region', { name: 'Announcement' })).toHaveCount(0);
  await expect(page.getByText('Free delivery on orders over $100')).toHaveCount(0);

  // Home benefits intact
  await expect(page.getByRole('region', { name: 'Shopping benefits' })).toBeVisible();
  await expect(page.getByText('Free Delivery', { exact: true })).toBeVisible();

  // Footer links verified
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'About Us' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Contact' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'All Products' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'My Account' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Help Center' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Shop by Category' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Featured Deals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Arrivals' })).toBeVisible();
  await expect(page.locator('[aria-labelledby="deals-title"] [data-testid="product-card"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[aria-labelledby="new-arrivals-title"] [data-testid="product-card"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toHaveCount(0);

  // Home responsive check
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const image of await page.locator('img[loading="lazy"]').all()) await image.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/catalog-local-home-${width}.png`, fullPage: true });
  }

  // Verify About Page
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'Technology made simple.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our values' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find your next upgrade' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore Products' })).toBeVisible();
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // Verify Search Page
  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(page.getByText('Find laptops, phones, audio, and more.')).toBeVisible();
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // Verify Products Page
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 60_000 });
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Browse categories' })).toHaveCount(0);
  await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByRole('group', { name: 'Category' })).toBeVisible();
  expect(await page.getByRole('group', { name: 'Category' }).getByRole('button').count()).toBeGreaterThan(1);
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();
  await expect(page.getByText('Filters are temporarily unavailable')).toHaveCount(0);
  await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByText('Sort by', { exact: true })).toBeVisible();

  const productLink = page.locator('[data-testid="product-card"] h3 a').nth(6);
  await productLink.scrollIntoViewIfNeeded();
  const productsScroll = await page.evaluate(() => window.scrollY);
  expect(productsScroll).toBeGreaterThan(0);
  await productLink.click();
  await expect(page.locator('[data-testid="product-gallery"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[role="tablist"][aria-label="Product thumbnails"] [role="tab"]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(productsScroll);
  await page.goForward();
  await expect(page.locator('[data-testid="product-gallery"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByText('Sign in to write a review of this product.')).toBeVisible({ timeout: 60_000 });
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/catalog-local-detail-1440.png', fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.reload();
  await expect(page.locator('[data-testid="product-gallery"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // Unauthenticated orders absent from header, present in footer
  await expect(page.getByRole('banner').getByRole('link', { name: 'Orders', exact: true })).toHaveCount(0);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign In Required' })).toBeVisible();
  await page.screenshot({ path: 'test-results/catalog-local-orders-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(unexpectedServerErrors).toEqual([]);
});
