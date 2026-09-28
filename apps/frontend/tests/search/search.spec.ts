import { test, expect } from '@playwright/test';

test('real Search API: matching fields, AND filters, sorting, exact prices and public summaries', async ({ request }) => {
  for (const query of ['macbook', 'sony headphones', 'apple laptop', 'iphone 16', 'WH-1000XM5', 'EH-025-001']) {
    const response = await request.get(`/api/search/products?${new URLSearchParams({ q: query })}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const product of body.data) {
      expect(product.price).toMatch(/^\d+\.\d{2}$/);
      expect(product).not.toHaveProperty('inventory');
      expect(product).not.toHaveProperty('specifications');
    }
  }
  const filtered = await request.get('/api/search/products?q=sony&category=headphones&brand=sony&availability=available');
  expect(filtered.status()).toBe(200);
  for (const product of (await filtered.json()).data) {
    expect(product.category.slug).toBe('headphones'); expect(product.brand.slug).toBe('sony'); expect(product.availability).toBe('AVAILABLE');
  }
  const priced = await request.get('/api/search/products?category=laptops&minPrice=100&maxPrice=2000&sort=price-asc');
  expect(priced.status()).toBe(200);
  const prices = (await priced.json()).data.map((product: { price: string }) => Number(product.price));
  expect(prices).toEqual([...prices].sort((first, second) => first - second));
  expect(prices.every((price: number) => price >= 100 && price <= 2000)).toBe(true);
  for (const path of ['page=1001', 'sort=featured', 'minPrice=-1', 'minPrice=10&maxPrice=1']) expect((await request.get(`/api/search/products?${path}`)).status()).toBe(400);
  const malicious = await request.get(`/api/search/products?${new URLSearchParams({ q: "%' OR 1=1 --" })}`);
  expect(malicious.status()).toBe(200); expect((await malicious.json()).data).toHaveLength(0);
  const suggestions = await request.get('/api/search/suggestions?q=mac&limit=8');
  expect(suggestions.status()).toBe(200); expect((await suggestions.json()).data.length).toBeLessThanOrEqual(8);
});

test('short and unlikely queries return products matching an approved field only', async ({ request }) => {
  for (const query of ['mm', '40mm', '16gb', 'bluetooth', 'laptop', 'tt', 'zzzzunlikely', 'macbook', 's24', 'sony', 'wireless']) {
    const response = await request.get(`/api/search/products?${new URLSearchParams({ q: query, pageSize: '100' })}`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    if (query === 'zzzzunlikely') expect(result.data).toHaveLength(0);
    await Promise.all(result.data.map(async (product: { slug: string }) => {
      const detailResponse = await request.get(`/api/products/${product.slug}`, { timeout: 20000 });
      expect(detailResponse.status()).toBe(200);
      const detail = (await detailResponse.json()).data;
      const fields = [detail.name, detail.sku, detail.modelNumber, detail.description, detail.brand?.name, detail.category?.name,
        ...(detail.specifications ?? []).flatMap((group: { group: string; items: { name: string; value: string }[] }) =>
          [group.group, ...group.items.flatMap(item => [item.name, item.value])])]
        .filter((value): value is string => Boolean(value)).map(value => value.toLocaleLowerCase());
      for (const token of query.toLocaleLowerCase().split(/\s+/)) {
        expect(fields.some(value => token.length < 3 ? new RegExp(`(^|[^a-z])${token}([^a-z]|$)`, 'i').test(value) : value.includes(token))).toBe(true);
      }
    }));
    const suggestions = await request.get(`/api/search/suggestions?${new URLSearchParams({ q: query, limit: '8' })}`);
    expect(suggestions.status()).toBe(200);
    const productSuggestions = (await suggestions.json()).data.filter((item: { type: string }) => item.type === 'PRODUCT');
    const resultIds = new Set(result.data.map((item: { id: string }) => item.id));
    for (const suggestion of productSuggestions) expect(resultIds.has(suggestion.id)).toBe(true);
  }
});

test('suggestion overlay stays above subsequent controls and supports mouse selection', async ({ page }) => {
  await page.goto('/search');
  const input = page.getByRole('combobox', { name: 'Search products' });
  await input.fill('sam');
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible();
  const optionBox = await option.boundingBox();
  expect(optionBox).not.toBeNull();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="option"]') !== null,
    { x: optionBox!.x + 12, y: optionBox!.y + optionBox!.height / 2 });
  expect(hit).toBe(true);
  await option.click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('empty-query /products loads a bounded public catalog page', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
  await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('status').first()).toContainText(/\d+ results?/);
});

for (const width of [390, 768, 1440, 1920]) {
  test(`real Search UI, keyboard, filters, history, local image and visual QA at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeVisible();
    const searchButton = page.getByRole('button', { name: 'Search', exact: true });
    await searchButton.focus(); await searchButton.press('Enter');
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole('link', { name: 'Cart', exact: true })).toBeVisible();
    const query = page.getByRole('combobox', { name: 'Search products' });
    await expect(query).toBeVisible();
    const sort = page.getByRole('combobox', { name: 'Sort by' });
    const queryBox = await query.boundingBox(); const sortBox = await sort.boundingBox();
    expect(queryBox).not.toBeNull(); expect(sortBox).not.toBeNull();
    if (width >= 768) expect(queryBox!.x + queryBox!.width).toBeLessThanOrEqual(sortBox!.x);
    else expect(sortBox!.y).toBeGreaterThanOrEqual(queryBox!.y);
    await page.screenshot({ path: testInfo.outputPath(`search-initial-${width}.png`), fullPage: true });
    await query.fill('mac');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 30000 });
    await query.press('ArrowDown'); await expect(query).toHaveAttribute('aria-activedescendant', /.+/);
    await query.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0);
    await query.fill('macbook');
    await expect(page).toHaveURL(/q=macbook/);
    await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Filters/ })).toHaveCount(0);
    await query.press('Escape');
    await page.screenshot({ path: testInfo.outputPath(`search-results-${width}.png`), fullPage: true });
    await page.goto('/products?q=macbook');
    await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search products' })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    const catalogInputBox = await page.getByRole('combobox', { name: 'Search products' }).boundingBox();
    const filterBox = await page.getByRole('button', { name: 'Filters', exact: true }).boundingBox();
    const catalogSortBox = await page.getByRole('combobox', { name: 'Sort by' }).boundingBox();
    expect(catalogInputBox).not.toBeNull(); expect(filterBox).not.toBeNull(); expect(catalogSortBox).not.toBeNull();
    expect(catalogInputBox!.width).toBeGreaterThan(filterBox!.width);
    expect(catalogInputBox!.width).toBeGreaterThan(catalogSortBox!.width);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('combobox', { name: 'Brand', exact: true }).click();
    await page.getByRole('option', { name: 'Apple', exact: true }).click();
    await expect(page).not.toHaveURL(/brand=apple/);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/brand=apple/);
    await page.getByRole('combobox', { name: 'Sort by' }).click();
    await page.getByRole('option', { name: 'Price: high to low' }).click();
    await expect(page).toHaveURL(/sort=price-desc/);
    await page.goBack(); await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText('Relevance');
    await page.goForward(); await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText('Price: high to low');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page).toHaveURL(/\/products\?q=macbook$/);
    await page.goto('/search?q=macbook');
    await expect(page.getByRole('button', { name: /Filters/ })).toHaveCount(0);
    await query.fill('no-such-electrohub-product');
    await expect(page).toHaveURL(/q=no-such-electrohub-product/);
    await expect(page.getByRole('heading', { name: /No results for/ })).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: testInfo.outputPath(`search-empty-${width}.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Image Search' }).click();
    await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`search-image-${width}.png`), fullPage: true });
    const imageRequests: string[] = [];
    page.on('request', request => { if (request.url().includes('/api/') && /image|upload/.test(request.url())) imageRequests.push(request.url()); });
    const browse = page.getByRole('button', { name: 'Browse files' });
    await browse.focus();
    const fileChooser = page.waitForEvent('filechooser');
    await browse.press('Enter');
    await (await fileChooser).setFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64') });
    await expect(page.getByRole('heading', { name: 'local.png' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove image' }).click(); expect(imageRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('controlled sanitized error and stale-response browser evidence', async ({ page }) => {
  await page.route('**/api/search/products?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Prisma SQL private details' } }) }));
  await page.goto('/search?q=macbook');
  await expect(page.getByRole('alert')).toContainText('Search is temporarily unavailable');
  await expect(page.getByRole('alert')).not.toContainText(/Prisma|SQL|private/);
  await page.unroute('**/api/search/products?**');
  await page.route('**/api/search/products?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old') await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) }).catch(() => undefined);
  });
  const input = page.getByRole('combobox', { name: 'Search products' });
  await input.fill('old'); await input.press('Enter');
  await input.fill('new'); await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'No results for “new”' })).toBeVisible();
  await page.waitForTimeout(600); await expect(input).toHaveValue('new');
});

test('real Search pagination has labeled controls and preserves query', async ({ page }) => {
  await page.goto('/search?q=apple&pageSize=1');
  await expect(page.getByRole('status').first()).toContainText('results', { timeout: 30000 });
  const next = page.getByRole('button', { name: 'Go to next page' });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/q=apple/);
  await expect(page.getByRole('button', { name: 'Go to previous page' })).toBeEnabled();
});

test('shared Footer is present on customer routes and absent from Admin login', async ({ page }) => {
  for (const route of ['/', '/search', '/products', '/cart']) {
    await page.goto(route);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    for (const content of ['ElectroHub', 'All Products', 'Laptops', 'Phones', 'Audio', 'Tablets', 'Accessories', 'My Account', 'Orders', 'Wishlist', 'Track Delivery', 'About Us', 'Careers', 'Press', 'Contact', 'Help Center', 'Returns & Refunds', 'Warranty', 'Privacy Policy', 'Terms of Service', '© 2026 ElectroHub. All rights reserved.']) {
      await expect(footer).toContainText(content);
    }
  }
  await page.goto('/admin/login');
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
});

test('page search overlays stay below sticky header and selectors remain aligned', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/search');
  const search = page.getByRole('combobox', { name: 'Search products' });
  await search.fill('sam'); await expect(page.getByRole('option').first()).toBeVisible();
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('[aria-label="Search products"]')!;
    window.scrollTo(0, window.scrollY + field.getBoundingClientRect().top - 35);
  });
  const headerOwnsTopLayer = await page.evaluate(() => {
    const header = document.querySelector('header')!;
    const headerStyle = getComputedStyle(header);
    const pageField = document.querySelector('[aria-label="Search products"]')!;
    const fieldStyle = getComputedStyle(pageField.parentElement!.parentElement!.parentElement!);
    const hit = document.elementFromPoint(20, 20);
    return Number(headerStyle.zIndex) > Number(fieldStyle.zIndex) && Boolean(hit?.closest('header'));
  });
  expect(headerOwnsTopLayer).toBe(true);
  await expect(page.getByRole('option').first()).toBeVisible();

  await page.goto('/products');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Product filters' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort by' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  const layers = await page.evaluate(() => ({
    header: Number(getComputedStyle(document.querySelector('header')!).zIndex),
    select: Number(getComputedStyle(document.querySelector('[role="listbox"]')!).zIndex),
  }));
  expect(layers.header).toBeGreaterThan(layers.select);
});

test('discovery controls use square surfaces and a full-width product filter panel', async ({ page }) => {
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/search?q=mm');
    const input = page.getByRole('combobox', { name: 'Search products' });
    await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
    expect(await input.evaluate(element => getComputedStyle(element).height)).toBe('40px');
    await input.fill('sam');
    const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });
    await expect(suggestions).toBeVisible();
    const inputBox = await input.boundingBox();
    const suggestionsBox = await suggestions.boundingBox();
    expect(inputBox && suggestionsBox && suggestionsBox.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
    expect(await input.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    expect(await page.getByTestId('product-card').first().evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    const searchBox = await input.boundingBox();
    const sort = page.getByRole('combobox', { name: 'Sort by' });
    expect(await sort.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    const sortBox = await sort.boundingBox();
    if (width < 768) expect(searchBox && sortBox && sortBox.y).toBeGreaterThan(searchBox!.y);
    else expect(searchBox && sortBox && sortBox.x - (searchBox.x + searchBox.width)).toBeGreaterThan(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (width === 1440) {
      await sort.click();
      const selectPanel = page.getByRole('listbox');
      await expect(selectPanel).toBeVisible();
      expect(await selectPanel.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
      expect(await selectPanel.getByRole('option').first().evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
      await page.keyboard.press('Escape');
      await input.fill('sam');
      const suggestionPanel = page.getByRole('listbox');
      await expect(suggestionPanel).toBeVisible();
      expect(await suggestionPanel.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    }

    await page.goto('/products');
    expect(await page.getByRole('combobox', { name: 'Search products' }).evaluate(element => getComputedStyle(element).height)).toBe('40px');
    expect(await page.getByRole('combobox', { name: 'Search products' }).evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Product filters' });
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    const containerBox = await page.locator('form[role="search"]').locator('xpath=..').boundingBox();
    expect(panelBox && containerBox && panelBox.width / containerBox.width).toBeGreaterThan(0.95);
    expect(await panel.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    expect(await page.getByRole('combobox', { name: 'Brand' }).evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    expect(await page.getByLabel('Min price ($)').evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    if (width === 1440) {
      for (const buttonName of ['Reset', 'Apply filters']) {
        const button = page.getByRole('button', { name: buttonName, exact: true });
        expect(await button.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
      }
    }
  }
  await page.goto('/search?q=zzzzunlikely');
  const emptyHeading = page.getByRole('heading', { name: 'No results for “zzzzunlikely”' });
  await expect(emptyHeading).toBeVisible();
  expect(await emptyHeading.evaluate(element => getComputedStyle(element.parentElement!).borderRadius)).toBe('0px');
  await page.route('**/api/search/products?**', async route => {
    await new Promise(resolve => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.goto('/search?q=mm');
  const skeleton = page.getByTestId('product-skeleton').first();
  await expect(skeleton).toBeVisible();
  expect(await skeleton.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
  const skeletonBox = await skeleton.boundingBox();
  const skeletonImageBox = await page.getByTestId('product-skeleton-image').first().boundingBox();
  await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
  const card = page.getByTestId('product-card').first();
  const cardBox = await card.boundingBox();
  const imageAreaBox = await card.locator(':scope > div').first().boundingBox();
  expect(skeletonBox && cardBox).toBeTruthy();
  expect(Math.abs(skeletonBox!.width - cardBox!.width)).toBeLessThanOrEqual(1);
  expect(skeletonBox!.height).toBeLessThanOrEqual(cardBox!.height + 2);
  expect(skeletonBox!.height).toBeGreaterThanOrEqual(cardBox!.height - 24);
  expect(skeletonImageBox && imageAreaBox).toBeTruthy();
  expect(Math.abs(skeletonImageBox!.height + 32 - imageAreaBox!.height)).toBeLessThanOrEqual(1);
});
