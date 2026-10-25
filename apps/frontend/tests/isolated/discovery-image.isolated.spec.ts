import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 04.2 REAL STACK (no interception): isolated frontend :3200 -> Express :5200 -> FastAPI (trained EfficientNet-B0
 * artifact) -> disposable pgvector QA -> Prisma catalog resolution. The query photo is a frozen held-out Wikimedia Commons test
 * query from the private training dataset (git-ignored, never committed); the test skips when that dataset is absent.
 *
 *   ISOLATED_BASE_URL=http://localhost:3200 ISOLATED_RUNTIME_TOKEN_FILE=../backend/.isolated-docker/runtime-token.txt \
 *     npx playwright test -c playwright.isolated.config.ts discovery-image
 *   ISOLATED_AI_DOWN=1 ... (with the AI service stopped) runs the outage checks instead of the live-model checks.
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://127.0.0.1:3200';
const here = path.dirname(fileURLToPath(import.meta.url));
const dataset = path.resolve(here, '../../../ai-service/training/.data/electrohub-commons-vision-v1');
const aiDown = process.env.ISOLATED_AI_DOWN === '1';
const shot = (name: string) => `test-results/isolated/discovery-${name}.png`;

type QueryPhoto = { file: string; family: string };
function heldOutQuery(): QueryPhoto | null {
  const manifest = path.join(dataset, 'manifests', 'test_queries.csv');
  if (!existsSync(manifest)) return null;
  const [header, ...rows] = readFileSync(manifest, 'utf8').trim().split(/\r?\n/);
  const columns = header.split(',');
  const wanted = process.env.ISOLATED_QUERY_FAMILY ?? 'Sony PlayStation 5 Launch Disc Edition';
  for (const row of rows) {
    const values = row.split(',');
    const record = Object.fromEntries(columns.map((name, index) => [name, values[index]]));
    if (record.family === wanted) return { file: path.join(dataset, 'images', record.path), family: record.family };
  }
  return null;
}

test.describe.configure({ mode: 'serial' });
test.use({ colorScheme: 'light', reducedMotion: 'reduce' });
test.beforeAll(() => {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base)) throw new Error('Refusing: local isolated frontend only.');
});

async function openPhotoMode(page: Page) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Search products' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Search by image' }).click();
  await expect(dialog.getByRole('heading', { name: 'Search with a photo' })).toBeVisible();
  return dialog;
}

test('header search and Ctrl+K open the same console on Home, Products and a product page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ['/', '/products']) {
    await page.goto(`${base}${route}`);
    const trigger = page.getByRole('button', { name: 'Search', exact: true });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Search products' })).toBeFocused();
    await page.keyboard.press('Escape');
  }
  const first = await (await page.request.get(`${base}/api/search/products?pageSize=1&sort=name-asc`)).json();
  await page.goto(`${base}/products/${first.data[0].slug}`);
  await expect(page.getByRole('heading', { level: 1, name: first.data[0].name })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a held-out Commons photo returns real, visible catalog products through the trained model', async ({ page }) => {
  test.skip(aiDown, 'outage run');
  const query = heldOutQuery();
  test.skip(!query || !existsSync(query.file), 'private Commons dataset not present on this machine');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto(`${base}/`);
    const dialog = await openPhotoMode(page);
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles(query!.file);
    // Selecting a photo only previews it: nothing is uploaded until Search.
    await expect(dialog.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    const response = page.waitForResponse(res => res.url().endsWith('/api/search/image') && res.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Search similar products' }).click();
    const answer = await response;
    expect(answer.status()).toBe(200);
    const body = await answer.json() as { data: { items: { slug: string; name: string; price: string }[] }; meta: { modelVersion: string } };
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.meta.modelVersion).toMatch(/^effb0-commons-/);
    const results = dialog.getByRole('region', { name: 'Visually similar products' });
    await expect(results).toBeVisible();
    await expect(results.getByRole('link')).toHaveCount(body.data.items.length);
    // Every card is a real, currently visible catalog product with its authoritative price.
    for (const item of body.data.items.slice(0, 5)) {
      const detail = await page.request.get(`${base}/api/products/${item.slug}`);
      expect(detail.status()).toBe(200);
      expect((await detail.json()).data.price).toBe(item.price);
    }
    await expect(dialog.getByText(/\d+(\.\d+)?%/)).toHaveCount(0); // no fabricated confidence percentages
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: shot(`results-${width}`) });
    await results.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/products/${body.data.items[0].slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: body.data.items[0].name })).toBeVisible();
  }
});

test('AI outage: photo search reports unavailable while text search and the catalog keep working', async ({ page }) => {
  test.skip(!aiDown, 'run with ISOLATED_AI_DOWN=1 and the AI service stopped');
  const query = heldOutQuery();
  test.skip(!query || !existsSync(query.file), 'private Commons dataset not present on this machine');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/`);
  const dialog = await openPhotoMode(page);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await (await chooser).setFiles(query!.file);
  await dialog.getByRole('button', { name: 'Search similar products' }).click();
  await expect(dialog.getByRole('heading', { name: 'Image search is unavailable right now' })).toBeVisible();
  await page.screenshot({ path: shot('ai-down-1440') });
  await dialog.getByRole('button', { name: 'Search by text' }).click();
  await page.keyboard.type('canon');
  await expect(dialog.getByRole('listbox', { name: 'Search suggestions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`${base}/products?category=cameras-photography`);
  await expect(page.getByRole('heading', { level: 1, name: 'Cameras & Photography' })).toBeVisible();
  const health = await page.request.get(`${base}/api/health`);
  expect(health.ok()).toBe(true);
});
