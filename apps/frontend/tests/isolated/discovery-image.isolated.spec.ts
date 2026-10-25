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
const shot = (name: string) => `playwright-report/task04-closure/discovery-${name}.png`;

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
test.use({ colorScheme: 'light', reducedMotion: 'reduce', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
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
  test.setTimeout(120_000); // Six real inference/navigation rounds, not a longer application request timeout.
  test.skip(aiDown, 'outage run');
  const query = heldOutQuery();
  test.skip(!query || !existsSync(query.file), 'private Commons dataset not present on this machine');
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto(`${base}/`);
    const dialog = await openPhotoMode(page);
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles(query!.file);
    // Selecting a photo only previews it: nothing is uploaded until Search.
    await expect(dialog.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    const selectedBounds = await dialog.boundingBox();
    const submitBounds = await dialog.getByRole('button', { name: 'Search similar products', exact: true }).boundingBox();
    expect(submitBounds!.x + submitBounds!.width).toBeLessThanOrEqual(selectedBounds!.x + selectedBounds!.width + 1);
    const status = dialog.getByRole('status', { name: 'Photo search status' });
    await expect(status).toContainText('Photo selected');
    await expect(dialog.getByRole('status')).toHaveCount(1);
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
    await expect(status).toContainText(`${body.data.items.length} visually similar`);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    // Every card is a real, currently visible catalog product with its authoritative price.
    for (const item of body.data.items.slice(0, 5)) {
      const detail = await page.request.get(`${base}/api/products/${item.slug}`);
      expect(detail.status()).toBe(200);
      expect((await detail.json()).data.price).toBe(item.price);
    }
    await expect(dialog.getByText(/\d+(\.\d+)?%/)).toHaveCount(0); // no fabricated confidence percentages
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    for (const name of ['Search again', 'Replace', 'Remove', 'Close search']) {
      const button = dialog.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    }
    // Retain a compact representative set; every viewport still executes layout and navigation assertions.
    if ([320, 768, 1440].includes(width)) await page.screenshot({ path: shot(`results-${width}`) });
    await results.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/products/${body.data.items[0].slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: body.data.items[0].name })).toBeVisible({ timeout: 30_000 });
  }
});

test('paste/drop validate photos, preserve explicit submission and release preview resources', async ({ page }) => {
  let uploads = 0;
  page.on('request', request => { if (request.url().endsWith('/api/search/image')) uploads++; });
  await page.goto(`${base}/`);
  const dialog = await openPhotoMode(page);
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
  for (const method of ['paste', 'drop'] as const) {
    for (const mime of ['image/gif', 'image/png']) {
      await dialog.evaluate((element, { method, mime, encoded }) => {
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'clipboard-photo.png', { type: mime }));
        if (method === 'paste') document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
        else element.querySelector('h3')!.parentElement!.parentElement!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }, { method, mime, encoded });
      if (mime === 'image/gif') await expect(dialog.getByRole('status', { name: 'Photo search status' })).toContainText('isn’t a supported image');
      else {
        await expect(dialog.getByRole('img', { name: 'Selected photo' })).toBeVisible();
        await expect(dialog.getByRole('status', { name: 'Photo search status' })).toContainText('Photo selected');
        expect(uploads).toBe(0);
        await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
      }
    }
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
});

test('controlled gateway states announce completion once and Escape cancels a pending photo search', async ({ page }) => {
  // Real rendered UI, deliberately controlled network failures. The separate held-out test proves actual ML results.
  const responses = [
    { status: 200, announcement: 'No similar products found' },
    { status: 503, announcement: 'Image search is unavailable right now' },
    { status: 504, announcement: 'The search took too long' },
    { status: 408, announcement: 'The search took too long' },
    { status: 500, announcement: 'Image search ran into a problem' },
  ];
  let index = 0;
  let release: (() => void) | undefined;
  await page.route('**/api/search/image', async route => {
    const response = responses[index++];
    if (!response) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: response?.status ?? 503, contentType: 'application/json', body: JSON.stringify(response?.status === 200 ? { data: { items: [] } } : { error: { code: 'CONTROLLED_QA_FAILURE', message: 'Controlled QA response' } }) }).catch(() => undefined);
  });
  await page.goto(`${base}/`);
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  const dialog = await openPhotoMode(page);
  await dialog.getByLabel('Choose a photo').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64') });
  const status = dialog.getByRole('status', { name: 'Photo search status' });
  for (const response of responses) {
    await dialog.getByRole('button', { name: /^(Search similar products|Search again)$/ }).click();
    await expect(status).toContainText(response.announcement);
    await expect(dialog.getByRole('status')).toHaveCount(1);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: 'Search again', exact: true }).click();
  await expect(status).toContainText('Finding visually similar products');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(status).toContainText('Photo selected');
  release?.();
  await expect(dialog.getByRole('button', { name: 'Search similar products', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('virtual camera captures, retakes and ends all tracks on selection and close', async ({ page }) => {
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    Object.assign(window, { discoveryTestStreams: streams });
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      streams.push(stream);
      return stream;
    };
  });
  await page.goto(`${base}/`);
  const dialog = await openPhotoMode(page);
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click();
  const shutter = dialog.getByRole('button', { name: 'Take photo' });
  await expect(shutter).toBeEnabled();
  await expect.poll(() => dialog.getByLabel('Live camera preview').evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await shutter.click();
  await expect(dialog.getByRole('img', { name: 'Captured photo' })).toBeVisible();
  const allEnded = () => page.evaluate(() => (window as Window & { discoveryTestStreams: MediaStream[] }).discoveryTestStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
  expect(await allEnded()).toBe(true);
  await dialog.getByRole('button', { name: 'Retake' }).click();
  await expect(shutter).toBeEnabled();
  await expect.poll(() => dialog.getByLabel('Live camera preview').evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await shutter.click();
  await dialog.getByRole('button', { name: 'Use this photo' }).click();
  await expect(dialog.getByRole('img', { name: 'Selected photo' })).toBeVisible();
  expect(await allEnded()).toBe(true);
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(shutter).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('heading', { name: 'Search with a photo' })).toBeVisible();
  expect(await allEnded()).toBe(true);
});

test('camera denial announces fallback and keyboard/200% zoom reflow/reduced motion remain usable', async ({ browser }) => {
  // 1440×1000 physical pixels at 200% browser-scale reflow: 720×500 CSS viewport, DPR 2.
  // This is explicit Chromium emulation, not a claim of operating a physical browser's zoom controls.
  const context = await browser.newContext({ viewport: { width: 720, height: 500 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied by test', 'NotAllowedError'); };
  });
  await page.goto(`${base}/`);
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await dialog.getByRole('button', { name: 'Search by image' }).click();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Camera access is blocked' })).toBeVisible();
  await expect(dialog.getByRole('status', { name: 'Camera status' })).toContainText('Camera access is blocked');
  await expect(dialog.getByRole('status')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Upload a photo' })).toBeVisible();
  expect(await dialog.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: shot('zoom200-camera-denied') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await context.close();
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
