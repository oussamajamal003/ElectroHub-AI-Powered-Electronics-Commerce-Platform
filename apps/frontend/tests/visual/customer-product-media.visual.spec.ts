import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/images/catalog');
const assets = new Map([
  ['/images/catalog/headphones.jpg', readFileSync(resolve(assetDirectory, 'headphones.jpg'))],
  ['/images/catalog/headphones-detail.jpg', readFileSync(resolve(assetDirectory, 'headphones-detail.jpg'))],
  ['/images/catalog/accessories.jpg', readFileSync(resolve(assetDirectory, 'accessories.jpg'))],
]);

const product = {
  id: 'product-headphones', name: 'Studio Headphones', slug: 'studio-headphones', sku: 'STUDIO-01', modelNumber: null,
  category: { id: 'category-audio', name: 'Audio', slug: 'audio' }, brand: { id: 'brand-electro', name: 'Electro', slug: 'electro' },
  images: [
    { id: 'photo-front', url: '/images/catalog/headphones.jpg', altText: 'Headphones front view', sortOrder: 0, isPrimary: true },
    { id: 'photo-side', url: '/images/catalog/headphones-detail.jpg', altText: '   ', sortOrder: 1, isPrimary: false },
    { id: 'photo-empty', url: '/images/catalog/headphones.jpg', altText: '', sortOrder: 2, isPrimary: false },
    { id: 'photo-null', url: '/images/catalog/headphones-detail.jpg', altText: null, sortOrder: 3, isPrimary: false },
  ],
  specifications: [], price: '129.99', compareAtPrice: '149.99', discountPercent: 13,
  averageRating: '4.8', reviewCount: 24, availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 12,
  purchasable: true, description: 'Comfortable wireless studio headphones.', currency: 'USD',
};
const related = {
  id: 'product-accessories', name: 'Audio Accessories', slug: 'audio-accessories', description: 'Everyday audio essentials.',
  price: '39.99', compareAtPrice: null, discountPercent: null, averageRating: '4.5', reviewCount: 9, currency: 'USD',
  availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 5, purchasable: true,
  category: { id: 'category-audio', name: 'Audio', slug: 'audio' }, brand: null,
  primaryImage: { id: 'accessories-photo', url: '/images/catalog/accessories.jpg', altText: 'Audio accessories', sortOrder: 0, isPrimary: true },
  secondaryImage: null,
};

test('customer gallery and related product card display published photos at four viewport widths', async ({ page }, testInfo) => {
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/wishlist') return route.fulfill({ json: { data: { items: [], totalItems: 0 } } });
    if (path === '/api/cart') return route.fulfill({ json: { data: { revision: '', items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } } });
    return route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } } });
  });
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { accessToken: 'visual-customer-token' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'customer-1', email: 'customer@electrohub.test', firstName: 'Customer', lastName: 'User', role: 'CUSTOMER' } } }));
  await page.route('**/api/products/studio-headphones', route => route.fulfill({ json: { data: product } }));
  await page.route('**/api/products/studio-headphones/reviews*', route => route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, summary: { averageRating: '4.8', reviewCount: 24 } } }));
  await page.route('**/api/search/products?**', route => route.fulfill({ json: { data: [related], meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 } } }));
  await page.route('**/images/catalog/**', route => {
    const bytes = assets.get(new URL(route.request().url()).pathname);
    return bytes ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: bytes }) : route.fulfill({ status: 404 });
  });

  await page.goto('/products/studio-headphones');
  const entryModuleResponse = await page.request.get(new URL('/src/main.tsx', page.url()).toString());
  expect(entryModuleResponse.status()).toBe(200);
  expect(entryModuleResponse.headers()['content-type']).toContain('javascript');
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  const gallery = page.getByTestId('product-gallery');
  const mainPhoto = gallery.locator('[role="tabpanel"] img');
  await expect.poll(() => mainPhoto.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => mainPhoto.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  const frontTab = gallery.getByRole('tab', { name: 'View Studio Headphones — image 1' });
  const sideTab = gallery.getByRole('tab', { name: 'View Studio Headphones — image 2' });
  const emptyAltTab = gallery.getByRole('tab', { name: 'View Studio Headphones — image 3' });
  const nullAltTab = gallery.getByRole('tab', { name: 'View Studio Headphones — image 4' });
  await expect(gallery.getByRole('tab')).toHaveCount(4);
  await expect(frontTab).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab).toBeVisible();
  await expect(emptyAltTab).toBeVisible();
  await expect(nullAltTab).toBeVisible();
  await frontTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab).toBeFocused();
  await expect(mainPhoto).toHaveAttribute('alt', 'Studio Headphones');
  await page.keyboard.press('ArrowLeft');
  await expect(frontTab).toHaveAttribute('aria-selected', 'true');
  await expect(frontTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(frontTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sideTab).toHaveAttribute('aria-selected', 'true');
  await emptyAltTab.focus();
  await page.keyboard.press('Enter');
  await expect(emptyAltTab).toHaveAttribute('aria-selected', 'true');
  await expect(mainPhoto).toHaveAttribute('alt', 'Studio Headphones');
  await nullAltTab.focus();
  await page.keyboard.press('Space');
  await expect(nullAltTab).toHaveAttribute('aria-selected', 'true');
  await expect(mainPhoto).toHaveAttribute('alt', 'Studio Headphones');
  await expect.poll(() => gallery.locator('[role="tabpanel"] img').getAttribute('src')).toBe('/images/catalog/headphones-detail.jpg');
  await expect.poll(() => gallery.locator('[role="tabpanel"] img').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await expect(page.getByRole('heading', { name: related.name })).toBeVisible();
  await expect(page.locator('img[src="/images/catalog/accessories.jpg"]')).toBeVisible();

  for (const [name, width, height, captureScreenshot] of [
    ['desktop', 1440, 1000, true], ['tablet-landscape', 1024, 900, false], ['tablet', 768, 1024, false], ['mobile', 390, 844, true],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(sideTab).toBeInViewport();
    await sideTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(frontTab).toHaveAttribute('aria-selected', 'true');
    await expect(frontTab).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await expect(sideTab).toHaveAttribute('aria-selected', 'true');
    await expect(sideTab).toBeFocused();
    await page.keyboard.press('Space');
    await expect(sideTab).toHaveAttribute('aria-selected', 'true');
    await expect(mainPhoto).toHaveAttribute('alt', 'Studio Headphones');
    await expect.poll(() => gallery.locator('[role="tabpanel"] img').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    if (captureScreenshot) await page.screenshot({ path: testInfo.outputPath(`customer-product-media-${name}.png`), fullPage: true });
  }
});
