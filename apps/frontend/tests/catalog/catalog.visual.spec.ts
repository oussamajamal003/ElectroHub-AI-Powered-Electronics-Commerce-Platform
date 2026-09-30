import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const dataset = JSON.parse(readFileSync(path.resolve(path.dirname(filename), '../../../backend/prisma/data/products.json'), 'utf8')) as {
  categories: { name: string; slug: string; description: string; imageUrl: string }[];
  brands: { name: string; slug: string }[];
  products: { name: string; slug: string; sku: string; categorySlug: string; brandSlug: string;
    description: string; modelNumber: string | null; price: string; compareAtPrice: string | null;
    quantity: number; images: { url: string; altText: string; sortOrder: number; isPrimary: boolean }[];
    specifications: { group: string; name: string; value: string; sortOrder: number }[] }[];
};

const category = (slug: string) => dataset.categories.find(item => item.slug === slug)!;
const brand = (slug: string) => dataset.brands.find(item => item.slug === slug)!;
let controlledCatalogFailure: { attempts: number; failing: boolean } | null = null;
type FixtureReview = { id: string; rating: number; body: string; createdAt: string; updatedAt: string; author: { displayName: string } };
let reviewFixture: { mode: 'empty' | 'populated' | 'lifecycle'; own: FixtureReview | null; entries: FixtureReview[]; productSlug: string; writeCount: number } | null = null;
let authenticatedFixture = false;
let delayedSearchQuery = '';
let delayedProductRequest: { slug: string; release: () => void } | null = null;
let delayedProductRequestEntered = false;
const reviewSummary = () => ({ averageRating: reviewFixture?.entries.length
  ? (reviewFixture.entries.reduce((total, review) => total + review.rating, 0) / reviewFixture.entries.length).toFixed(1) : null,
reviewCount: reviewFixture?.entries.length ?? 0 });
const productViewBySlug = new Map<string, number>();
const categoryViewCount = new Map<string, number>();
for (const product of dataset.products) {
  const index = categoryViewCount.get(product.categorySlug) ?? 0;
  productViewBySlug.set(product.slug, index % 2);
  categoryViewCount.set(product.categorySlug, index + 1);
}
const summaries = dataset.products.map((product, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name: product.name, slug: product.slug, description: product.description.slice(0, 160), price: product.price,
  compareAtPrice: product.compareAtPrice, discountPercent: product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price)
    ? Math.round((Number(product.compareAtPrice) - Number(product.price)) / Number(product.compareAtPrice) * 100) : null,
  averageRating: index % 5 === 0 ? null : (3.5 + index % 3 / 2).toFixed(1),
  reviewCount: index % 5 === 0 ? 0 : 3 + index * 2,
  currency: 'USD', availability: product.quantity > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
  category: { id: product.categorySlug, name: category(product.categorySlug).name, slug: product.categorySlug },
  brand: { id: product.brandSlug, name: brand(product.brandSlug).name, slug: product.brandSlug },
  primaryImage: { id: `image-${index}`, url: `/images/catalog/${product.categorySlug}${productViewBySlug.get(product.slug) ? '-detail' : ''}.jpg`,
    altText: `Representative ${product.categorySlug} studio photograph, illustrative`, sortOrder: 0, isPrimary: true },
  secondaryImage: { id: `image-alt-${index}`, url: `/images/catalog/${product.categorySlug}${productViewBySlug.get(product.slug) ? '' : '-detail'}.jpg`,
    altText: `Alternate representative ${product.categorySlug} studio photograph, illustrative`, sortOrder: 1, isPrimary: false },
}));

test.beforeEach(async ({ page }) => {
  controlledCatalogFailure = null;
  reviewFixture = null;
  authenticatedFixture = false;
  delayedSearchQuery = '';
  delayedProductRequest = null;
  delayedProductRequestEntered = false;
  await page.route('**/api/**', async route => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    const respond = (payload: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (pathname === '/api/auth/me' && authenticatedFixture) return respond({ user: { id: 'local-customer', role: 'CUSTOMER', firstName: 'Local', lastName: 'Reviewer', email: 'reviewer@example.test' } });
    if (pathname.startsWith('/api/auth/')) return respond({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }, 401);
    if (pathname === '/api/categories') return respond({ data: dataset.categories.map(item => ({ ...item,
      imageUrl: `/images/catalog/${item.slug}.jpg`,
      id: item.slug, productCount: summaries.filter(product => product.category.slug === item.slug).length })),
      meta: { page: 1, pageSize: 100, total: dataset.categories.length } });
    if (pathname === '/api/brands') return respond({ data: dataset.brands.map(item => ({ ...item, id: item.slug })),
      meta: { page: 1, pageSize: 100, total: dataset.brands.length } });
    if (pathname === '/api/products/deals') {
      const data = summaries.filter(product => product.discountPercent !== null).slice(0, 6);
      return respond({ data, meta: { page: 1, pageSize: 6, total: data.length } });
    }
    if (pathname.endsWith('/reviews/me')) {
      if (route.request().method() === 'GET') return respond({ data: reviewFixture?.own ?? null });
      if (!reviewFixture) return respond({ error: { code: 'NOT_FOUND', message: 'Review not found.' } }, 404);
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { rating: number; body: string };
        const updated = { ...reviewFixture.own!, ...body, updatedAt: new Date().toISOString() };
        reviewFixture.own = updated;
        reviewFixture.entries = reviewFixture.entries.map(entry => entry.id === updated.id ? updated : entry);
        reviewFixture.writeCount++;
        return respond({ data: updated, summary: reviewSummary() });
      }
      if (route.request().method() === 'DELETE') {
        const deletedId = reviewFixture.own?.id;
        reviewFixture.own = null;
        reviewFixture.entries = reviewFixture.entries.filter(entry => entry.id !== deletedId);
        reviewFixture.writeCount++;
        return route.fulfill({ status: 204, body: '' });
      }
    }
    if (pathname.endsWith('/reviews')) {
      if (route.request().method() === 'POST' && reviewFixture) {
        const body = route.request().postDataJSON() as { rating: number; body: string };
        const created: FixtureReview = { id: 'own-review', ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: { displayName: 'You' } };
        reviewFixture.own = created; reviewFixture.entries.push(created); reviewFixture.writeCount++;
        return respond({ data: created, summary: reviewSummary() }, 201);
      }
      const entries = reviewFixture?.entries.length ? reviewFixture.entries : reviewFixture?.mode === 'populated' ? [{ id: 'review-fixture', rating: 5,
        body: 'Clear display and reliable battery life.', createdAt: '2026-09-01T10:00:00.000Z',
        author: { displayName: 'Catalog customer' } }] : [];
      const requestPage = Number(requestUrl.searchParams.get('page') ?? '1');
      const pageSize = 10;
      const averageRating = entries.length ? (entries.reduce((total, item) => total + item.rating, 0) / entries.length).toFixed(1) : null;
      return respond({ data: entries.slice((requestPage - 1) * pageSize, requestPage * pageSize),
        summary: { averageRating, reviewCount: entries.length },
        meta: { page: requestPage, pageSize, total: entries.length, totalPages: Math.ceil(entries.length / pageSize) } });
    }
    if (pathname.startsWith('/api/products/') && !pathname.endsWith('/reviews/me')) {
      const slug = decodeURIComponent(pathname.split('/')[3] ?? '');
      if (delayedProductRequest?.slug === slug) await new Promise<void>(resolve => { delayedProductRequestEntered = true; delayedProductRequest!.release = resolve; });
      const source = dataset.products.find(item => item.slug === slug);
      const summary = summaries.find(item => item.slug === slug);
      if (!source || !summary) return respond({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } }, 404);
      const reviewEntries = reviewFixture?.productSlug === slug ? reviewFixture.entries : null;
      const reviewCount = reviewEntries?.length ?? summary.reviewCount;
      const averageRating = reviewEntries?.length ? (reviewEntries.reduce((total, review) => total + review.rating, 0) / reviewEntries.length).toFixed(1) : reviewEntries ? null : summary.averageRating;
      return respond({ data: { ...summary, reviewCount, averageRating, description: source.description, sku: source.sku, modelNumber: source.modelNumber,
        images: source.images.map((image, index) => ({ id: `detail-${index}`,
          url: `/images/catalog/${source.categorySlug}${((productViewBySlug.get(source.slug) ?? 0) ? index === 0 : index === 1) ? '-detail' : ''}.jpg`,
          altText: `Representative ${index ? 'alternate ' : ''}${source.categorySlug} studio view, illustrative`,
          sortOrder: index, isPrimary: index === 0 })),
        specifications: [...new Set(source.specifications.map(item => item.group))].map(group => ({ group,
          items: source.specifications.filter(item => item.group === group).map((item, index) => ({ id: `${group}-${index}`, ...item })) })) } });
    }
    if (pathname === '/api/products' || pathname === '/api/search/products') {
      if (pathname === '/api/search/products' && controlledCatalogFailure) {
        controlledCatalogFailure.attempts++;
        if (controlledCatalogFailure.failing) return respond({ error: { code: 'INTERNAL_ERROR', message: 'private database detail' } }, 503);
      }
      const query = (requestUrl.searchParams.get('q') ?? '').toLowerCase();
      if (query === delayedSearchQuery) await new Promise(resolve => setTimeout(resolve, 600));
      const categorySlug = requestUrl.searchParams.get('category');
      const brandSlug = requestUrl.searchParams.get('brand');
      const availability = requestUrl.searchParams.get('availability');
      const minPrice = Number(requestUrl.searchParams.get('minPrice') ?? '0');
      const maxPrice = Number(requestUrl.searchParams.get('maxPrice') ?? Number.MAX_SAFE_INTEGER);
      const filtered = summaries.filter(product => (!query || product.name.toLowerCase().includes(query)) &&
        (!categorySlug || product.category.slug === categorySlug) && (!brandSlug || product.brand.slug === brandSlug) &&
        (!availability || product.availability === (availability === 'available' ? 'AVAILABLE' : 'UNAVAILABLE')) &&
        Number(product.price) >= minPrice && Number(product.price) <= maxPrice);
      const sort = requestUrl.searchParams.get('sort');
      if (sort === 'price-asc') filtered.sort((left, right) => Number(left.price) - Number(right.price));
      if (sort === 'price-desc') filtered.sort((left, right) => Number(right.price) - Number(left.price));
      const pageNumber = Number(requestUrl.searchParams.get('page') ?? '1');
      const pageSize = Number(requestUrl.searchParams.get('pageSize') ?? '20');
      return respond({ data: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        meta: { page: pageNumber, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) } });
    }
    if (pathname.endsWith('/reviews/me')) return respond({ data: null });
    return respond({ data: [] });
  });
});

const shots = [
  { documented: 'Home page(1).png', actual: 'Home page.png', height: 911, route: '/', target: 'hero' },
  { documented: 'Home.png', actual: 'Home.png', height: 906, route: '/', target: 'New Arrivals' },
  { documented: 'Home_page.png', actual: 'Home_page.png', height: 906, route: '/', target: 'Shop by Category' },
  { documented: 'homepage.png', actual: 'homepage.png', height: 909, route: '/', target: 'Explore more' },
  { documented: 'Home-page.png', actual: 'Home-page.png', height: 907, route: '/', target: 'Featured Deals' },
  { documented: 'product details page.png', actual: 'product details page.png', height: 907, route: `/products/${dataset.products[0].slug}`, target: 'top' },
  { documented: 'Product_details_page.png', actual: 'Product_details_page.png', height: 907, route: `/products/${dataset.products[3].slug}`, target: 'top' },
  { documented: 'product-details-page.png', actual: 'product-details-page.png', height: 906, route: `/products/${dataset.products[1].slug}`, target: 'More in' },
  { documented: 'Products page(1).png', actual: 'Products page.png', height: 907, route: '/products', target: 'top' },
  { documented: 'products_page.png', actual: 'products_page.png', height: 909, route: '/products', target: 'pagination' },
  { documented: 'Productspage.png', actual: 'Productspage.png', height: 911, route: '/products?page=2', target: 'top' },
  { documented: 'products-page(1).png', actual: 'products-page.png', height: 907, route: '/products?q=I7', target: 'empty' },
] as const;

shots.forEach((shot, screenshotIndex) => {
  test(`${String(screenshotIndex + 1).padStart(2, '0')} ${shot.documented} maps to ${shot.actual}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: shot.height });
    await page.goto(shot.route);
    if (shot.route === '/') await expect(page.getByRole('heading', { name: 'New Arrivals' })).toBeVisible();
    else if (shot.route.startsWith('/products/')) await expect(page.getByRole('heading', { name: dataset.products.find(item => shot.route.endsWith(item.slug))!.name })).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
    if (shot.route === '/') {
      await expect(page.getByText('Loading new arrivals…')).toHaveCount(0);
      await expect(page.getByText('Loading categories…')).toHaveCount(0);
      await expect(page.getByText('Loading deals…')).toHaveCount(0);
    } else if (!shot.route.startsWith('/products/')) {
      await expect(page.getByRole('status').filter({ hasText: /^\d+ (?:result|results)/ })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Searching products…' })).toHaveCount(0);
    }
    if (shot.target === 'empty') await expect(page.getByText('No results for “I7”')).toBeVisible();
    const scrollTo = async (locator: ReturnType<typeof page.locator>) => locator.evaluate(element => window.scrollTo(0,
      element.getBoundingClientRect().top + window.scrollY - 110));
    if (shot.target === 'pagination') await page.getByRole('navigation', { name: 'Search result pages' }).evaluate(element => window.scrollTo(0,
      element.getBoundingClientRect().top + window.scrollY - 720));
    if (shot.route === '/products?page=2') await page.evaluate(() => window.scrollTo(0, 510));
    if (shot.target === 'More in') await scrollTo(page.getByRole('heading', { name: /More in/ }));
    if (shot.target === 'New Arrivals' || shot.target === 'Shop by Category' || shot.target === 'Featured Deals') {
      await scrollTo(page.getByRole('heading', { name: shot.target }));
    }
    if (shot.target === 'Explore more') await scrollTo(page.getByRole('region', { name: 'Explore electronics' }));
    await page.screenshot({ path: testInfo.outputPath(shot.actual), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('catalog navigation, category filtering, detail, gallery, tabs and empty recovery', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Smartphones 3 products/ }).click();
  await expect(page).toHaveURL(/\/products\?category=smartphones/);
  await expect(page.getByText('3 results')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Shop by Category' })).toBeVisible();
  await page.goto('/products');
  await expect(page.getByText('24 results')).toBeVisible();
  await page.getByRole('link', { name: dataset.products[0].name }).first().click();
  await expect(page).toHaveURL(new RegExp(`/products/${dataset.products[0].slug}$`));
  await expect(page.getByRole('heading', { name: dataset.products[0].name })).toBeVisible();
  const thumbnails = page.getByRole('tablist', { name: 'Product thumbnails' }).getByRole('tab');
  await thumbnails.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(thumbnails.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(thumbnails.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Specifications' }).click();
  await expect(page.getByRole('heading', { name: 'Specifications' })).toBeVisible();
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByText('No reviews yet. Be the first to share your experience.')).toBeVisible();
  await page.goto('/products?q=zzzzunlikely');
  await expect(page.getByText('No results for “zzzzunlikely”')).toBeVisible();
  await page.getByRole('button', { name: 'Clear query' }).click();
  await expect(page.getByText('24 results')).toBeVisible();
});

test('pagination preserves browser navigation', async ({ page }) => {
  await page.goto('/products');
  const pager = page.getByRole('navigation', { name: 'Search result pages' });
  await expect(pager.getByRole('button', { name: 'Go to previous page' })).toBeDisabled();
  await pager.getByRole('button', { name: 'Go to next page' }).click();
  await expect(page).toHaveURL(/\/products\?page=2/);
  await expect(pager.getByRole('button', { name: 'Go to page 2' })).toHaveAttribute('aria-current', 'page');
  await expect(pager.getByRole('button', { name: 'Go to next page' })).toBeDisabled();
  await page.goBack();
  await expect(pager.getByRole('button', { name: 'Go to page 1' })).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(pager.getByRole('button', { name: 'Go to page 2' })).toHaveAttribute('aria-current', 'page');
});

test('controlled catalog error offers a sanitized retry', async ({ page }) => {
  const failure = { attempts: 0, failing: true };
  controlledCatalogFailure = failure;
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Search unavailable' })).toBeVisible();
  await expect(page.getByText('private database detail')).toHaveCount(0);
  const attemptsBeforeRetry = failure.attempts;
  failure.failing = false;
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.getByText('24 results')).toBeVisible();
  expect(failure.attempts).toBe(attemptsBeforeRetry + 1);
});

test('empty and populated public review states render with bounded pagination', async ({ page }) => {
  const fixture = { mode: 'empty' as const, own: null as FixtureReview | null, entries: [] as FixtureReview[], productSlug: dataset.products[0].slug, writeCount: 0 };
  reviewFixture = fixture;
  await page.goto(`/products/${dataset.products[0].slug}`);
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByText('No reviews yet. Be the first to share your experience.')).toBeVisible();
  fixture.mode = 'populated';
  fixture.entries = Array.from({ length: 11 }, (_, index) => ({ id: `public-review-${index}`, rating: index === 10 ? 3 : 5,
    body: `Fixture review ${index + 1}`, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', author: { displayName: `Customer ${index + 1}` } }));
  await page.reload();
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByText('Fixture review 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reviews (11)' })).toBeVisible();
  await expect(page.getByText('★ 4.8 (11 reviews)')).toBeVisible();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Fixture review 11')).toBeVisible();
  await expect(page.getByText('Fixture review 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('★ 4.8 (11 reviews)')).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByText('Fixture review 1', { exact: true })).toBeVisible();
});

test('authenticated customer can create, update and delete only their own review', async ({ page }) => {
  authenticatedFixture = true;
  const fixture = { mode: 'lifecycle' as const, own: null as FixtureReview | null, entries: [] as FixtureReview[], productSlug: dataset.products[0].slug, writeCount: 0 };
  reviewFixture = fixture;
  await page.goto(`/products/${fixture.productSlug}`);
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await page.getByLabel('Your review').fill('My first local review');
  await page.getByRole('button', { name: 'Post review' }).click();
  await expect(page.getByRole('article').getByText('My first local review')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reviews (1)' })).toBeVisible();
  await expect(page.getByText('★ 5.0 (1 reviews)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit your review' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Rating' }).click();
  await page.getByRole('option', { name: '4 stars' }).click();
  await page.getByLabel('Your review').fill('Updated local review');
  await page.getByRole('button', { name: 'Update review' }).click();
  await expect(page.getByRole('article').getByText('Updated local review')).toBeVisible();
  await expect(page.getByText('★ 4.0 (1 reviews)')).toBeVisible();
  expect(fixture.writeCount).toBe(2);
  fixture.entries.unshift({ id: 'other-customer-review', rating: 2, body: 'Another customer review',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: { displayName: 'Another customer' } });
  await page.reload();
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByText('Another customer review')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit your review' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete review' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('Updated local review')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Reviews (1)' })).toBeVisible();
  await expect(page.getByText('Another customer review')).toBeVisible();
  expect(fixture.writeCount).toBe(3);
});

test('combined live Search, filters, sort, reset and browser history stay synchronized', async ({ page }) => {
  await page.goto('/products');
  const search = page.getByRole('combobox', { name: 'Search products' });
  delayedSearchQuery = 'wireless';
  await search.fill('wireless');
  await expect(page).toHaveURL(/q=wireless/);
  await search.fill('galaxy');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=galaxy/);
  await expect(page.getByRole('link', { name: 'Samsung Galaxy S24 256GB' }).first()).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByRole('link', { name: 'Samsung Galaxy S24 256GB' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /wireless/i })).toHaveCount(0);
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Smartphones' }).click();
  await page.getByRole('combobox', { name: 'Brand' }).click();
  await page.getByRole('option', { name: 'Samsung' }).click();
  await page.getByRole('combobox', { name: 'Availability' }).click();
  await page.getByRole('option', { name: 'Available', exact: true }).click();
  await page.getByLabel('Min price ($)').fill('700');
  await page.getByLabel('Max price ($)').fill('800');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/category=smartphones/);
  await expect(page).toHaveURL(/brand=samsung/);
  await expect(page).toHaveURL(/availability=available/);
  await expect(page).toHaveURL(/minPrice=700/);
  await expect(page).toHaveURL(/maxPrice=800/);
  await expect(page.getByRole('link', { name: 'Samsung Galaxy S24 256GB' }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Price: high to low' }).click();
  await expect(page).toHaveURL(/sort=price-desc/);
  const filteredUrl = page.url();
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page).toHaveURL(/q=galaxy/);
  await expect(page).not.toHaveURL(/category=|brand=|availability=|minPrice=|maxPrice=/);
  await expect(page.getByRole('link', { name: 'Samsung Galaxy S24 256GB' }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByRole('link', { name: 'Samsung Galaxy S24 256GB' }).first()).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/q=galaxy/);
});

test('availability is explicit and no purchase controls are shown', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByText('In stock').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Search result pages' }).getByRole('button', { name: 'Go to next page' }).click();
  await expect(page.getByText('Out of stock').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Add to cart|Buy now/i })).toHaveCount(0);
});

test('ProductCard shows its alternate image on hover without a hover-time request', async ({ page }) => {
  const imageRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/images/catalog/')) imageRequests.push(request.url()); });
  await page.goto('/products');
  const card = page.locator('[data-testid="product-card"]').first();
  const primary = card.locator('img[alt]').first();
  const alternate = card.locator('[aria-hidden="true"] img');
  await expect(primary).toBeVisible();
  await expect(alternate).toHaveAttribute('src', /-detail\.jpg$/);
  await expect.poll(() => alternate.evaluate(image => (image as HTMLImageElement).complete)).toBe(true);
  const requestCount = imageRequests.length;
  await primary.hover();
  await expect.poll(() => alternate.evaluate(image => getComputedStyle(image.parentElement!.parentElement!).opacity)).toBe('1');
  expect(imageRequests).toHaveLength(requestCount);
});

test('Review updates preserve the Product Gallery and reduced motion remains usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  authenticatedFixture = true;
  const fixture: FixtureReview = { id: 'existing-own-review', rating: 5, body: 'Existing review content', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', author: { displayName: 'You' } };
  reviewFixture = { mode: 'lifecycle', own: fixture, entries: [fixture], productSlug: dataset.products[0].slug, writeCount: 0 };
  await page.goto(`/products/${dataset.products[0].slug}`);
  await expect(page.getByRole('heading', { name: dataset.products[0].name })).toBeVisible();
  const thumbnails = page.getByRole('tablist', { name: 'Product thumbnails' }).getByRole('tab');
  await thumbnails.nth(1).click();
  delayedProductRequest = { slug: dataset.products[0].slug, release: () => undefined };
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await page.getByLabel('Your review').fill('Updated to trigger product refetch');
  await page.getByRole('button', { name: 'Update review' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your review has been saved.' })).toBeVisible();
  expect(delayedProductRequestEntered).toBe(false);
  await expect(page.getByRole('heading', { name: dataset.products[0].name })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading product details' })).toHaveCount(0);
  await expect(thumbnails.nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(await page.getByRole('heading', { name: dataset.products[0].name }).count()).toBe(1);
  delayedProductRequest = null;
  await page.getByRole('tab', { name: 'Specifications' }).click();
  await expect(page.getByRole('heading', { name: 'Specifications' })).toBeVisible();
  const runningAnimations = await page.locator('main *').evaluateAll(elements => elements.flatMap(element =>
    element.getAnimations().filter(animation => animation.playState === 'running' &&
      (animation.effect?.getComputedTiming().endTime ?? 0) > 100).map(animation => animation.constructor.name)));
  expect(runningAnimations).toEqual([]);
});

test('keyboard traversal reaches catalog discovery and detail controls', async ({ page }) => {
  const phone = dataset.products.find(product => product.categorySlug === 'smartphones' && product.name.includes('Galaxy'))!;
  reviewFixture = { mode: 'populated', own: null, entries: Array.from({ length: 11 }, (_, index) => ({ id: `keyboard-review-${index}`, rating: 5,
    body: `Keyboard review ${index + 1}`, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', author: { displayName: `Customer ${index + 1}` } })), productSlug: phone.slug, writeCount: 0 };
  await page.goto('/products');
  const breadcrumbHome = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Home' });
  await breadcrumbHome.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/');
  const categoryLink = page.getByRole('link', { name: /Smartphones 3 products/ });
  await categoryLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/category=smartphones/);
  const search = page.getByRole('combobox', { name: 'Search products' });
  await search.focus();
  await page.keyboard.type('Galaxy');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=Galaxy/i);
  await page.getByRole('button', { name: /Filters/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Product filters' })).toBeVisible();
  const sort = page.getByRole('combobox', { name: 'Sort by' });
  await sort.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: 'Name: A–Z' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sort=name-asc/);
  await page.getByRole('link', { name: phone.name }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/products/${phone.slug}$`));
  const thumbs = page.getByRole('tablist', { name: 'Product thumbnails' }).getByRole('tab');
  await thumbs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(thumbs.nth(1)).toHaveAttribute('aria-selected', 'true');
  const tabList = page.getByRole('tablist', { name: 'Product information' });
  await tabList.getByRole('tab', { name: 'Description' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabList.getByRole('tab', { name: 'Specifications' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabList.getByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Keyboard review 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Keyboard review 11', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Keyboard review 1', { exact: true })).toBeVisible();
});

for (const width of [390, 768, 1440]) {
  test(`responsive catalog and detail at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/products', `/products/${dataset.products[0].slug}`]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: route === '/products' ? 'All Products' : dataset.products[0].name })).toBeVisible();
      if (route === '/products') await expect(page.getByText('24 results')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${route === '/products' ? 'catalog' : 'detail'}-${width}.png`), animations: 'disabled' });
    }
  });
}
