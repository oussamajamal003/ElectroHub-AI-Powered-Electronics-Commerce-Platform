import { expect, test } from '@playwright/test';

const enabled = process.env.EH_RUN_LIVE_MEDIA_DEV === 'true';
const productId = process.env.EH_DEV_MEDIA_PRODUCT_ID;
const productName = process.env.EH_DEV_MEDIA_PRODUCT_NAME;
const adminEmail = process.env.EH_DEV_MEDIA_ADMIN_EMAIL;
const adminPassword = process.env.EH_DEV_MEDIA_ADMIN_PASSWORD;
const writeEnabled = process.env.EH_LIVE_MEDIA_DEV_WRITE === 'true';
const ownedImageIds = (process.env.EH_DEV_MEDIA_OWNED_IMAGE_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
const apiPath = (path: string) => new URL(path, 'http://127.0.0.1:3200').pathname;

test('authenticated DEV product media route reads real gallery at desktop and mobile sizes', async ({ page }, testInfo) => {
  test.skip(!enabled, 'Set EH_RUN_LIVE_MEDIA_DEV=true to opt into the live DEV media browser check.');
  expect(productId, 'EH_DEV_MEDIA_PRODUCT_ID is required for the live DEV check.').toBeTruthy();
  expect(productName, 'EH_DEV_MEDIA_PRODUCT_NAME is required for the live DEV check.').toBeTruthy();
  expect(adminEmail, 'EH_DEV_MEDIA_ADMIN_EMAIL is required for the live DEV check.').toBeTruthy();
  expect(adminPassword, 'EH_DEV_MEDIA_ADMIN_PASSWORD is required for the live DEV check.').toBeTruthy();

  await page.goto('/admin/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('#admin-email').fill(adminEmail!);
  await page.locator('#admin-password').fill(adminPassword!);
  const loginResponsePromise = page.waitForResponse(response =>
    apiPath(response.url()) === '/api/auth/login' && response.request().method() === 'POST', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Sign In' }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  const loginBody = await loginResponse.json() as { user?: { role?: string } };
  expect(loginBody.user?.role).toBe('ADMIN');
  await page.waitForURL(url => url.pathname.startsWith('/admin') && url.pathname !== '/admin/login', { timeout: 120_000 });

  const productEndpoint = `/api/admin/products/${encodeURIComponent(productId!)}`;
  const imagesEndpoint = `${productEndpoint}/images`;
  const expectReadResponses = () => Promise.all([
    page.waitForResponse(response => apiPath(response.url()) === productEndpoint && response.request().method() === 'GET', { timeout: 120_000 }),
    page.waitForResponse(response => apiPath(response.url()) === imagesEndpoint && response.request().method() === 'GET', { timeout: 120_000 }),
  ]);

  let productReads = expectReadResponses();
  await page.goto(`/admin/products/${encodeURIComponent(productId!)}/media`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  let [productResponse, imagesResponse] = await productReads;
  expect(productResponse.status()).toBe(200);
  expect(imagesResponse.status()).toBe(200);
  const productBody = await productResponse.json() as { data?: { id?: string; name?: string } };
  const imagesBody = await imagesResponse.json() as { data?: Array<{ id: string; url: string; isPrimary?: boolean; indexing?: { state?: string } }> };
  expect(productBody.data?.id).toBe(productId);
  expect(productBody.data?.name).toBe(productName);
  await expect(page.getByRole('heading', { name: productName! })).toBeVisible({ timeout: 120_000 });
  const gallery = page.getByRole('list', { name: 'Published product photos' });
  await expect(gallery).toBeVisible({ timeout: 120_000 });
  await expect(gallery.getByRole('listitem')).toHaveCount(imagesBody.data?.length ?? 0);
  const cards = gallery.getByRole('listitem');
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const image = card.locator('img');
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth), { timeout: 120_000 }).toBeGreaterThan(0);
    await expect.poll(() => image.evaluate(element => getComputedStyle(element).opacity), { timeout: 120_000 }).toBe('1');
    await expect(card.getByTestId('product-image-skeleton')).toHaveCount(0, { timeout: 120_000 });
  }

  await page.screenshot({ path: testInfo.outputPath('live-admin-media-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('live-admin-media-390.png'), fullPage: true });

  productReads = expectReadResponses();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  [productResponse, imagesResponse] = await productReads;
  expect(productResponse.status()).toBe(200);
  expect(imagesResponse.status()).toBe(200);
  await expect(page.getByRole('heading', { name: productName! })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('list', { name: 'Published product photos' })).toBeVisible({ timeout: 120_000 });

  if (writeEnabled) {
    expect(ownedImageIds, 'Set EH_DEV_MEDIA_OWNED_IMAGE_IDS to the comma-separated IDs created for this fixture.').toHaveLength(2);
    const currentImagesBody = await imagesResponse.json() as { data?: Array<{ id: string; isPrimary?: boolean }> };
    const currentImages = currentImagesBody.data ?? [];
    expect(currentImages.map(image => image.id).sort()).toEqual([...ownedImageIds].sort());
    const firstId = ownedImageIds[0]!;
    const secondId = ownedImageIds[1]!;
    const firstIndex = currentImages.findIndex(image => image.id === firstId);
    const secondIndex = currentImages.findIndex(image => image.id === secondId);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);

    const waitForPatch = () => page.waitForResponse(response =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname.startsWith(`${imagesEndpoint}/`), { timeout: 120_000 });
    const firstCard = cards.nth(firstIndex);
    const firstAlt = firstCard.getByLabel('Alt text');
    let mutation: Promise<import('@playwright/test').Response> | undefined;
    if (await firstAlt.inputValue() !== 'Task QA first view') {
      mutation = waitForPatch();
      await firstAlt.fill('Task QA first view');
      await firstAlt.press('Tab');
      expect((await mutation).status()).toBe(200);
    }

    const refreshedCards = gallery.getByRole('listitem');
    const secondCard = refreshedCards.nth(secondIndex);
    const secondAlt = secondCard.getByLabel('Alt text');
    if (await secondAlt.inputValue() !== 'Task QA detail view') {
      mutation = waitForPatch();
      await secondAlt.fill('Task QA detail view');
      await secondAlt.press('Tab');
      expect((await mutation).status()).toBe(200);
    }

    const cardWithAlt = async (value: string) => {
      const currentCards = gallery.getByRole('listitem');
      for (let index = 0; index < await currentCards.count(); index += 1) {
        const card = currentCards.nth(index);
        if (await card.getByLabel('Alt text').inputValue() === value) return card;
      }
      throw new Error(`The owned photo with alt text ${value} is not present.`);
    };
    const secondOwned = await cardWithAlt('Task QA detail view');
    const setPrimary = secondOwned.getByRole('button', { name: 'Set primary' });
    if (await setPrimary.count()) {
      mutation = waitForPatch();
      await setPrimary.click();
      expect((await mutation).status()).toBe(200);
    }

    const movingCard = gallery.getByRole('listitem').nth(1);
    mutation = waitForPatch();
    await movingCard.getByRole('button', { name: /Move photo \d+ up/ }).click();
    expect((await mutation).status()).toBe(200);

    const replaceCard = await cardWithAlt('Task QA first view');
    await replaceCard.getByRole('button', { name: 'Replace' }).click();
    await page.locator('input[aria-label="Choose replacement photo"]').setInputFiles('public/images/catalog/accessories.jpg');
    await expect(page.getByText('Replacement preview', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('live-admin-replacement-preview-1440.png'), fullPage: true });
    const replacement = page.waitForResponse(response =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith(`/${firstId}/file`), { timeout: 120_000 });
    await page.getByRole('button', { name: 'Upload 1 photo' }).click();
    expect((await replacement).status()).toBe(200);
    await expect(page.getByText('Photo replaced. AI indexing status updates separately.')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Replacement preview', { exact: true })).toHaveCount(0, { timeout: 120_000 });

    const removeCard = await cardWithAlt('Task QA first view');
    const removeButton = removeCard.getByRole('button', { name: 'Remove' });
    await page.screenshot({ path: testInfo.outputPath('live-admin-before-removal-1440.png'), fullPage: true });
    await removeButton.click();
    await page.getByRole('heading', { name: 'Remove this photo?' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(removeButton).toBeFocused();
    await removeButton.click();
    const removal = page.waitForResponse(response =>
      response.request().method() === 'DELETE' && new URL(response.url()).pathname.endsWith(`/${firstId}`), { timeout: 120_000 });
    await page.getByRole('button', { name: 'Remove photo' }).click();
    expect((await removal).status()).toBe(200);

    productReads = expectReadResponses();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    [productResponse, imagesResponse] = await productReads;
    expect(productResponse.status()).toBe(200);
    expect(imagesResponse.status()).toBe(200);
    const finalImages = await imagesResponse.json() as { data?: Array<{ id: string }> };
    expect(finalImages.data?.map(image => image.id)).toEqual([secondId]);
    await expect(page.getByRole('heading', { name: productName! })).toBeVisible({ timeout: 120_000 });
    const finalGallery = page.getByRole('list', { name: 'Published product photos' });
    await expect(finalGallery.getByRole('listitem')).toHaveCount(1, { timeout: 120_000 });
    const finalCard = finalGallery.getByRole('listitem').first();
    const finalImage = finalCard.locator('img');
    await expect.poll(() => finalImage.evaluate(element => (element as HTMLImageElement).naturalWidth), { timeout: 120_000 }).toBeGreaterThan(0);
    await expect.poll(() => finalImage.evaluate(element => getComputedStyle(element).opacity), { timeout: 120_000 }).toBe('1');
    await expect(finalCard.getByTestId('product-image-skeleton')).toHaveCount(0, { timeout: 120_000 });
    await page.screenshot({ path: testInfo.outputPath('live-admin-final-one-image-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('live-admin-final-one-image-390.png'), fullPage: true });
  }
});
