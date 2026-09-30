import { expect, test } from '@playwright/test';

for (const width of [390, 768, 1440, 1920]) {
  test(`benefits and company motion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 500 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const banner = page.getByRole('region', { name: 'Shopping benefits' });
    const columns = banner.locator(':scope > div > div');
    await expect(columns).toHaveCount(3);
    await expect(banner.getByText('Free Delivery')).toBeAttached();
    await expect(banner.getByText('2-Year Warranty')).toBeAttached();
    await expect(banner.getByText('24/7 Support')).toBeAttached();
    await expect(banner.locator(':scope > div')).toHaveClass(/pending/);
    await banner.scrollIntoViewIfNeeded();
    await expect(banner.locator(':scope > div')).toHaveClass(/visible/);
    await page.waitForTimeout(700);
    await expect(banner.locator(':scope > div')).not.toHaveClass(/pending/);
    const columnsLayout = await columns.evaluateAll(items => items.map(item => {
      const rect = item.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    if (width < 768) {
      expect(columnsLayout[0]?.y).toBeLessThan(columnsLayout[1]?.y ?? 0);
      expect(columnsLayout[1]?.y).toBeLessThan(columnsLayout[2]?.y ?? 0);
    } else {
      expect(Math.max(...columnsLayout.map(item => item.width)) - Math.min(...columnsLayout.map(item => item.width))).toBeLessThan(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/benefits-${width}.png` });

    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    const about = page.getByRole('heading', { name: 'What we offer' });
    await about.scrollIntoViewIfNeeded();
    await expect(about.locator('..')).toHaveClass(/visible/);
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    const contact = page.getByRole('heading', { name: 'Send a message' });
    await contact.scrollIntoViewIfNeeded();
    await expect(contact.locator('xpath=../..')).toHaveClass(/visible/);
  });
}

test('reduced motion keeps benefits static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const banner = page.getByRole('region', { name: 'Shopping benefits' });
  await expect(banner.getByText('24/7 Support')).toBeVisible();
  const duration = await banner.locator(':scope > div > div').first().evaluate(element => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.001);
});

test('mobile sign-out closes navigation and sends one logout request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: {
    id: 'demo', firstName: 'Demo', lastName: 'User', email: 'demo@example.com', role: 'CUSTOMER',
  } }) }));
  let logoutRequests = 0;
  await page.route('**/api/auth/logout', route => {
    logoutRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile Navigation' }).getByRole('link', { name: 'Orders' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Mobile Navigation' }).getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile Navigation' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Orders' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  expect(logoutRequests).toBe(1);
});

test('real localhost product pages request only their page and reuse cached page 1', async ({ page }) => {
  test.skip(!process.env.CATALOG_REAL_LOCAL, 'Requires the local product API');
  test.setTimeout(180_000);
  const requests: { url: string; start: number; end?: number }[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/search/products?')) requests.push({ url: request.url(), start: performance.now() });
  });
  page.on('response', response => {
    const entry = requests.find(request => request.url === response.url() && request.end === undefined);
    if (entry) entry.end = performance.now();
  });
  const startPageOne = performance.now();
  await page.goto('/products?page=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 90_000 });
  const pageOneMs = Math.round(performance.now() - startPageOne);
  const pageOneCount = requests.length;
  const pageOneApiMs = Math.round((requests[0]?.end ?? performance.now()) - (requests[0]?.start ?? startPageOne));
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible();
  }
  const startPageTwo = performance.now();
  await page.getByRole('button', { name: 'Go to page 2' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect.poll(() => requests.length).toBe(pageOneCount + 1);
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 90_000 });
  const pageTwoMs = Math.round(performance.now() - startPageTwo);
  const pageTwoCount = requests.length - pageOneCount;
  const pageTwoApiMs = Math.round((requests[pageOneCount]?.end ?? performance.now()) - (requests[pageOneCount]?.start ?? startPageTwo));
  const startCachedReturn = performance.now();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible();
  const cachedPageOneMs = Math.round(performance.now() - startCachedReturn);
  const cachedReturnCount = requests.length - pageOneCount - pageTwoCount;
  console.log(JSON.stringify({ pageOneCount, pageOneApiMs, pageOneMs, pageTwoCount, pageTwoApiMs, pageTwoMs, cachedPageOneMs, cachedReturnCount, productRequests: requests.map(request => request.url) }));
  expect(pageOneCount).toBe(1);
  expect(pageTwoCount).toBe(1);
  expect(cachedReturnCount).toBe(0);
  expect(requests.every(request => !/[?&]page=[3-9]/.test(request.url))).toBe(true);
});
