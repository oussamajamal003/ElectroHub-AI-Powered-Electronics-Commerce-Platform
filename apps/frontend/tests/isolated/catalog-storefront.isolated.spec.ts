import { expect, test, type Page } from '@playwright/test';

/**
 * Catalog expansion Part 2 REAL STACK (no interception): isolated frontend :3200 -> isolated backend :5200 -> disposable
 * PostgreSQL seeded with the 16-category expanded catalog. Read-only: no cart, wishlist or order writes. UI facts are
 * compared with the live category/search APIs instead of hardcoded totals. Screenshots land in
 * test-results/isolated/storefront-*.png.
 *   npx playwright test -c playwright.isolated.config.ts catalog-storefront
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://127.0.0.1:3200';
const newCategories = ['cameras-photography', 'speakers-audio', 'storage-ssds', 'computer-components', 'networking-wifi',
  'smart-home', 'keyboards-mice', 'printers-scanners'];
const shot = (name: string) => `test-results/isolated/storefront-${name}.png`;
type ApiCategory = { name: string; slug: string; productCount: number; imageUrl: string | null };

test.describe.configure({ mode: 'serial' });
// Reduced motion renders every reveal immediately, so element screenshots never capture mid-fade cards; it also
// exercises the reduced-motion path end to end.
test.use({ colorScheme: 'light', reducedMotion: 'reduce' });
test.beforeAll(() => {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base)) throw new Error('Refusing: local isolated frontend only.');
});

async function apiCategories(page: Page): Promise<ApiCategory[]> {
  const response = await page.request.get(`${base}/api/categories?page=1&pageSize=100`);
  expect(response.status()).toBe(200);
  return (await response.json()).data as ApiCategory[];
}

/** Forces lazy images to load, then reports which ones failed to decode. */
async function brokenImages(page: Page, selector: string) {
  return page.$$eval(selector, async images => {
    for (const image of images as HTMLImageElement[]) image.loading = 'eager';
    await Promise.all((images as HTMLImageElement[]).map(image => image.decode().catch(() => null)));
    return (images as HTMLImageElement[]).filter(image => !image.complete || image.naturalWidth === 0).map(image => image.getAttribute('src'));
  });
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('Home exposes all storefront categories, largest first, with working images and live counts', async ({ page }) => {
  const categories = await apiCategories(page);
  expect(categories.map(category => category.slug)).toEqual(expect.arrayContaining(newCategories));
  const ordered = [...categories].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/`);
  const grid = page.locator('#home-category-grid');
  await grid.scrollIntoViewIfNeeded();
  const cards = grid.getByRole('link');
  await expect(cards).toHaveCount(Math.min(8, categories.length));
  for (const [index, category] of ordered.slice(0, 8).entries()) {
    await expect(cards.nth(index)).toHaveAttribute('href', `/products?category=${category.slug}`);
    await expect(cards.nth(index)).toContainText(`${category.productCount} product`);
  }
  expect(await brokenImages(page, '#home-category-grid img')).toEqual([]);
  await page.locator('section[aria-labelledby="categories-title"]').screenshot({ path: shot('home-categories-1440') });

  const toggle = page.getByRole('button', { name: `View all ${categories.length} categories` });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Show fewer categories' })).toHaveAttribute('aria-expanded', 'true');
  await expect(cards).toHaveCount(categories.length);
  for (const slug of newCategories) await expect(grid.locator(`a[href="/products?category=${slug}"]`)).toBeVisible();
  expect(await brokenImages(page, '#home-category-grid img')).toEqual([]);
  await page.locator('section[aria-labelledby="categories-title"]').screenshot({ path: shot('home-categories-expanded-1440') });

  for (const width of [320, 390, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.goto(`${base}/`);
    await page.locator('#home-category-grid').scrollIntoViewIfNeeded();
    await noHorizontalScroll(page);
    const box = await page.locator('#home-category-grid a').first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(130); // never tiny unreadable cards
    await page.locator('section[aria-labelledby="categories-title"]').screenshot({ path: shot(`home-categories-${width}`) });
  }
});

test('every new category deep link shows its real products, title and count', async ({ page }) => {
  const categories = await apiCategories(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const slug of newCategories) {
    const category = categories.find(value => value.slug === slug)!;
    const search = await (await page.request.get(`${base}/api/search/products?category=${slug}&pageSize=100`)).json();
    expect(search.meta.total).toBe(category.productCount);
    await page.goto(`${base}/products?category=${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: category.name })).toBeVisible();
    await expect(page.getByText(`${category.productCount} product${category.productCount === 1 ? '' : 's'}`, { exact: true })).toBeVisible();
    const hrefs = await page.locator('main a[href^="/products/"]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')))]);
    expect(hrefs.length).toBeGreaterThan(0);
    const expected = new Set((search.data as { slug: string }[]).map(product => `/products/${product.slug}`));
    for (const href of hrefs) expect(expected.has(href!)).toBe(true);
    expect(await brokenImages(page, 'main img')).toEqual([]);
    if (slug === 'cameras-photography' || slug === 'computer-components') await page.screenshot({ path: shot(`products-${slug}-1440`), fullPage: false });
  }
});

test('the original eight categories still filter correctly', async ({ page }) => {
  const categories = (await apiCategories(page)).filter(category => !newCategories.includes(category.slug));
  expect(categories).toHaveLength(8);
  for (const category of categories) {
    await page.goto(`${base}/products?category=${category.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: category.name })).toBeVisible();
    await expect(page.getByText(`${category.productCount} product${category.productCount === 1 ? '' : 's'}`, { exact: true })).toBeVisible();
  }
});

test('one product per new category opens a complete detail page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const slug of newCategories) {
    const search = await (await page.request.get(`${base}/api/search/products?category=${slug}&pageSize=1&sort=name-asc`)).json();
    const product = search.data[0] as { slug: string; name: string };
    await page.goto(`${base}/products/${product.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible();
    await expect(page.getByText(/SKU: EH-CE-\d{3}/)).toBeVisible();
    await expect(page.getByRole('button', { name: /add to cart/i }).first()).toBeEnabled();
    expect(await brokenImages(page, 'main img')).toEqual([]);
    if (slug === 'cameras-photography') await page.screenshot({ path: shot('detail-1440') });
  }
});

test('the default catalog mixes every category on page one and the footer links live categories', async ({ page }) => {
  const categories = await apiCategories(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/products`);
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toContainText('Category mix');
  await expect(page).toHaveURL(`${base}/products`);
  const cardCategories = await page.locator('main a[href^="/products/"]').evaluateAll(async links => {
    const slugs = [...new Set(links.map(link => link.getAttribute('href')))];
    return Promise.all(slugs.map(async href => (await (await fetch(`/api${href}`)).json()).data.category.slug as string));
  });
  expect(new Set(cardCategories).size).toBe(Math.min(categories.length, 20));
  const footerLinks = page.getByRole('navigation', { name: 'Shop' }).getByRole('link');
  const ordered = [...categories].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name)).slice(0, 8);
  await expect(footerLinks).toHaveText(['All Products', ...ordered.map(category => category.name)]);
  for (const category of ordered) {
    await expect(page.getByRole('navigation', { name: 'Shop' }).getByRole('link', { name: category.name, exact: true }))
      .toHaveAttribute('href', `/products?category=${category.slug}`);
  }
  await page.getByRole('navigation', { name: 'Shop' }).screenshot({ path: shot('footer-shop-1440') });
});

test('products toolbar and category filter stay coherent at every breakpoint', async ({ page }) => {
  const categories = await apiCategories(page);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.goto(`${base}/products?sort=price-asc&page=2`);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const select = page.getByRole('combobox', { name: 'Category' });
    await expect(select).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: shot(`products-filters-${width}`) });
    if (width === 390 || width === 1440) {
      await select.click();
      // Every API category is selectable, with its live count.
      await expect(page.getByRole('option')).toHaveCount(categories.length + 1);
      await page.screenshot({ path: shot(`products-category-menu-${width}`) });
      await page.getByRole('option', { name: /^Smart Home \(/ }).click();
      await expect(page).toHaveURL(/category=smart-home/);
      await expect(page).toHaveURL(/sort=price-asc/);
      await expect(page).not.toHaveURL(/page=2/);
      await expect(page.getByRole('heading', { level: 1, name: 'Smart Home' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Smart Home' })).toBeVisible();
    }
  }
});
