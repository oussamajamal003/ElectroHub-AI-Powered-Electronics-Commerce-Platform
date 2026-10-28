import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const imageFixture = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../public/images/catalog/headphones.jpg'));

const product = { id: 'product-1', name: 'Studio Headphones', slug: 'studio-headphones' };
const photo = {
  id: 'image-1', productId: product.id, url: '/images/catalog/headphones.jpg', altText: 'Headphones front', sortOrder: 0,
  isPrimary: true, sourceRevision: 'revision-1', mediaState: 'PUBLISHED', width: 800, height: 800, updatedAt: '2026-10-28T12:00:00.000Z',
  indexing: { state: 'PENDING', embeddingVersion: 'd3', errorCode: null },
};

test('admin media workflow previews uploads and stays usable on desktop and mobile', async ({ page }, testInfo) => {
  page.on('pageerror', error => console.log('media-pageerror', error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('media-console-error', message.text()); });
  page.on('response', response => { if (response.status() >= 400) console.log('media-bad-response', response.status(), response.url()); });
  let images = [] as typeof photo[];
  let uploadCount = 0;
  let failFirstUpload = true;
  const secondPhoto = { ...photo, id: 'image-2', url: '/images/catalog/headphones-detail.jpg', altText: 'Headphones side', sortOrder: 1, isPrimary: false, sourceRevision: 'revision-2' };
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { accessToken: 'visual-admin-token' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'admin-1', email: 'admin@electrohub.test', firstName: 'Admin', lastName: 'User', role: 'ADMIN' } } }));
  await page.route('**/api/admin/products**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/admin/products' && request.method() === 'GET') return route.fulfill({ json: { data: [product] } });
    if (url.pathname === `/api/admin/products/${product.id}` && request.method() === 'GET') return route.fulfill({ json: { data: product } });
    if (url.pathname === `/api/admin/products/${product.id}/images` && request.method() === 'GET') return route.fulfill({ json: { data: [...images].sort((left, right) => left.sortOrder - right.sortOrder) } });
    if (url.pathname === `/api/admin/products/${product.id}/images` && request.method() === 'POST') {
      uploadCount += 1;
      if (failFirstUpload) {
        failFirstUpload = false;
        return route.fulfill({ status: 503, json: { error: { message: 'Storage is temporarily unavailable.' } } });
      }
      const created = uploadCount > 2 ? secondPhoto : photo;
      images = [...images, { ...created, sortOrder: images.length, isPrimary: images.length === 0 }];
      return route.fulfill({ status: 201, json: { data: created } });
    }
    const imageMatch = new RegExp(`/api/admin/products/${product.id}/images/([^/]+)(?:/(file|retry))?$`).exec(url.pathname);
    if (imageMatch && request.method() === 'PUT') {
      const existing = images.find(item => item.id === imageMatch[1])!;
      const updated = { ...existing, url: '/images/catalog/headphones-detail.jpg', sourceRevision: 'revision-3', updatedAt: '2026-10-28T12:00:01.000Z' };
      images = images.map(item => item.id === imageMatch[1] ? updated : item);
      return route.fulfill({ json: { data: updated } });
    }
    if (imageMatch && request.method() === 'PATCH') {
      const patch = request.postDataJSON() as { altText?: string; isPrimary?: true; sortOrder?: number };
      if (typeof patch.sortOrder === 'number') {
        const ordered = [...images].sort((left, right) => left.sortOrder - right.sortOrder);
        const movedIndex = ordered.findIndex(item => item.id === imageMatch[1]);
        const [moved] = ordered.splice(movedIndex, 1);
        ordered.splice(patch.sortOrder, 0, moved!);
        images = ordered.map((item, index) => ({ ...item, sortOrder: index, updatedAt: `2026-10-28T12:00:${String(index + 2).padStart(2, '0')}.000Z` }));
      } else {
        images = images.map(item => ({ ...item, ...(item.id === imageMatch[1] ? patch : {}), ...(patch.isPrimary ? { isPrimary: item.id === imageMatch[1] } : {}) }));
      }
      return route.fulfill({ json: { data: images.find(item => item.id === imageMatch[1]) } });
    }
    if (imageMatch && request.method() === 'DELETE') {
      images = images.filter(item => item.id !== imageMatch[1]);
      return route.fulfill({ json: { data: { id: imageMatch[1] } } });
    }
    if (imageMatch && request.method() === 'POST' && imageMatch[2] === 'retry') {
      const updated = { ...photo, indexing: { ...photo.indexing, state: 'PENDING' as const } };
      images = images.map(item => item.id === imageMatch[1] ? updated : item);
      return route.fulfill({ json: { data: updated } });
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Not found' } } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/products');
  // Exercise the browser's ordinary index.html -> main.tsx startup path. No
  // page-side module injection: direct admin route loads must mount naturally.
  await expect(page.getByRole('heading', { name: 'Product media' })).toBeVisible();
  await page.keyboard.press('Tab');
  const productsNav = page.locator('aside a[href="/admin/products"]');
  await expect(productsNav).toBeFocused();
  expect(await productsNav.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  await page.getByRole('link', { name: 'Manage media for Studio Headphones' }).click();
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  await expect(page.getByText('No product photos yet')).toBeVisible();

  await page.getByLabel('Choose product photos').setInputFiles({ name: 'headphones.jpg', mimeType: 'image/jpeg', buffer: imageFixture });
  await expect(page.getByRole('region', { name: 'Selected photo previews' })).toBeVisible();
  await expect(page.getByAltText('Preview of headphones.jpg')).toBeVisible();
  await expect.poll(() => page.getByAltText('Preview of headphones.jpg').evaluate(element => (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-media-upload-preview-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Upload 1 photo' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be uploaded');
  await expect(page.getByRole('region', { name: 'Selected photo previews' })).toBeVisible();
  await page.getByRole('button', { name: 'Upload 1 photo' }).click();
  await expect(page.getByText('AI indexing pending')).toBeVisible();
  await expect.poll(() => page.locator('img[src="/images/catalog/headphones.jpg"]').first().evaluate(element => (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect.poll(() => page.locator('img[src="/images/catalog/headphones.jpg"]').first().evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.screenshot({ path: testInfo.outputPath('admin-media-pending-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-media-pending-tablet.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-media-pending-large-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-media-pending-mobile.png'), fullPage: true });

  await page.getByLabel('Choose product photos').setInputFiles({ name: 'headphones-side.jpg', mimeType: 'image/jpeg', buffer: imageFixture });
  await page.getByRole('button', { name: 'Upload 1 photo' }).click();
  await expect(page.getByRole('list', { name: 'Published product photos' }).getByLabel('Move photo 2 up')).toBeEnabled();
  const secondCard = page.getByRole('list', { name: 'Published product photos' }).locator('li').nth(1);
  await secondCard.getByRole('button', { name: 'Set primary' }).click();
  await expect(secondCard.getByText('Primary')).toBeVisible();
  await page.getByRole('list', { name: 'Published product photos' }).getByLabel('Move photo 2 up').click();
  await page.getByRole('list', { name: 'Published product photos' }).locator('li').first().getByLabel('Alt text').fill('Front view of studio headphones');
  await page.keyboard.press('Tab');
  await expect(page.getByText('Saving photo changes…')).toHaveCount(0);

  await page.getByRole('list', { name: 'Published product photos' }).getByRole('button', { name: 'Replace' }).first().click();
  await page.getByLabel('Choose replacement photo').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: imageFixture });
  await expect(page.getByText('Current', { exact: true })).toBeVisible();
  await expect(page.getByText('Replacement preview', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByAltText('Replacement preview for replacement.jpg').evaluate(element => (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Upload 1 photo' }).click();

  // Half the mobile CSS viewport approximates a 200% browser zoom without the non-reflowing CSS `zoom` property.
  await page.setViewportSize({ width: 195, height: 422 });
  await expect(page.getByRole('button', { name: /Remove/ }).first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('admin-media-200-percent-reduced-motion.png'), fullPage: true });

  const removeButton = page.getByRole('button', { name: 'Remove' }).first();
  await removeButton.click();
  await expect(page.getByRole('heading', { name: 'Remove this photo?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(removeButton).toBeFocused();
  await removeButton.click();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByRole('list', { name: 'Published product photos' }).locator('li')).toHaveCount(1);
});

test('direct product media route mounts and loads after a browser refresh', async ({ page }) => {
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { accessToken: 'visual-admin-token' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'admin-1', email: 'admin@electrohub.test', firstName: 'Admin', lastName: 'User', role: 'ADMIN' } } }));
  await page.route('**/api/admin/products**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/admin/products/${product.id}`) return route.fulfill({ json: { data: product } });
    if (url.pathname === `/api/admin/products/${product.id}/images`) return route.fulfill({ json: { data: [photo] } });
    return route.fulfill({ status: 404, json: { error: { message: 'Not found' } } });
  });
  await page.route('**/images/catalog/headphones.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: imageFixture }));

  await page.goto(`/admin/products/${product.id}/media`);
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Published product photos' }).getByAltText('Headphones front')).toBeVisible();
  await expect.poll(() => page.getByAltText('Headphones front').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
