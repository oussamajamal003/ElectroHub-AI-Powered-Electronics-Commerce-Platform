import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Task 04.6 real Chromium QA (T6-01 … T6-09, AC2/AC4/AC5) against the disposable stack from apps/backend/scripts/delivery-qa-stack.cjs, whose
 * Vite server points VITE_MAP_TILE_URL at a local loopback tile stub: no public tile server is contacted. Map data is the real API response;
 * the only injected fault is the aborted tile route of T6-04.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const pointer = path.join(root, '.cache', 'delivery-qa-stack.current');
const state = existsSync(pointer) ? JSON.parse(readFileSync(readFileSync(pointer, 'utf8').trim(), 'utf8')) as { frontend: string; tiles?: string; credentials: string } : null;
const fixtures = state ? JSON.parse(readFileSync(state.credentials, 'utf8')) as {
  customer: { email: string; password: string };
  orders: Record<'outFresh' | 'outNoLocation' | 'outRoute' | 'outSimulated' | 'delivered', string> } : null;
const base = state?.frontend ?? 'http://localhost:3310';
const tiles = state?.tiles ?? '';
const shots = path.resolve(here, '../../screenshots/delivery-04.6');
mkdirSync(shots, { recursive: true });

test.skip(!fixtures?.orders.outRoute || !tiles, 'Start apps/backend/scripts/delivery-qa-stack.cjs first (disposable QA stack with the tile stub).');
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: fixtures!.customer.email, password: fixtures!.customer.password } });
  expect(login.status()).toBe(200);
}
async function axe(page: Page) {
  await page.addScriptTag({ content: readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
  return page.evaluate(async () => (await Reflect.get(window, 'axe').run(document.querySelector('main') ?? document,
    { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`));
}
const isMapChunk = (request: Request) => /LeafletDeliveryMap|\/deps\/leaflet|\/leaflet\/dist\//.test(request.url());
const panelOf = (page: Page) => page.locator('section[aria-labelledby="delivery-location-heading"]');
const mapRegion = (page: Page) => page.locator('.leaflet-container');
async function openTracking(page: Page, reference: string) {
  await page.goto(`${base}/orders/${reference}/tracking`);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`Track order ${reference}`) })).toBeVisible();
}
async function mapReady(page: Page) {
  await expect(mapRegion(page)).toBeVisible();
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
}

test('T6-01 recorded route: markers, solid recorded line, legend, caption, attribution; fit bounds keeps every marker in view', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await signIn(page);
  await openTracking(page, fixtures!.orders.outRoute);
  await mapReady(page);
  const panel = panelOf(page);
  // Text summary first, then the map (DOM order = visual order).
  const summaryBox = await panel.locator('#delivery-map-summary').boundingBox();
  const mapBox = (await mapRegion(page).boundingBox())!;
  expect(summaryBox!.y).toBeLessThan(mapBox.y);
  await expect(mapRegion(page)).toHaveAttribute('aria-describedby', 'delivery-map-summary');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  const line = page.locator('.leaflet-overlay-pane path');
  await expect(line).toHaveCount(1);
  expect(await line.getAttribute('stroke-dasharray')).toBeNull();
  for (const text of ['Dispatch hub', 'Latest position', 'Recorded positions', 'Delivery area']) await expect(panel.getByRole('list', { name: 'Map legend' })).toContainText(text);
  await expect(panel).toContainText('It is not a planned road route.');
  await expect(panel.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
  for (const marker of await page.locator('.leaflet-marker-icon').all()) {
    const box = (await marker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(mapBox.x); expect(box.x + box.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
    expect(box.y).toBeGreaterThanOrEqual(mapBox.y); expect(box.y + box.height).toBeLessThanOrEqual(mapBox.y + mapBox.height);
  }
  expect(await axe(page)).toEqual([]);
  await panel.screenshot({ path: path.join(shots, 'map-recorded-1440.png') });
  expect(errors).toEqual([]);
});

test('T6-02 / AC4 no coordinates: text summary only and the Leaflet chunk is never requested', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => { if (isMapChunk(request) || request.url().startsWith(tiles)) requested.push(request.url()); });
  await signIn(page);
  for (const key of ['outNoLocation', 'delivered'] as const) {
    await openTracking(page, fixtures!.orders[key]);
    await expect(page.locator('#delivery-map-summary')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(mapRegion(page)).toHaveCount(0);
    await panelOf(page).screenshot({ path: path.join(shots, `map-${key}-1440.png`) });
  }
  expect(requested).toEqual([]);
});

test('route unavailable: a single recorded position shows the courier marker and the route-unavailable caption', async ({ page }) => {
  await signIn(page);
  await openTracking(page, fixtures!.orders.outFresh);
  await mapReady(page);
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
  await expect(panelOf(page)).toContainText('Route not available.');
  await panelOf(page).screenshot({ path: path.join(shots, 'map-route-unavailable-1440.png') });
});

test('T6-04 tile host blocked: warning + Retry, summary intact; Retry restores the map', async ({ page }) => {
  await signIn(page);
  await page.route(`${tiles}/**`, route => route.abort('connectionrefused'));
  await openTracking(page, fixtures!.orders.outRoute);
  const panel = panelOf(page);
  await expect(panel.getByRole('alert')).toContainText("The map couldn't load.");
  await expect(panel.locator('#delivery-map-summary')).toContainText('Out for delivery.');
  await expect(mapRegion(page)).toHaveCount(0);
  await panel.screenshot({ path: path.join(shots, 'map-tile-error-1440.png') });
  await page.unroute(`${tiles}/**`);
  await panel.getByRole('button', { name: 'Retry map' }).click();
  await mapReady(page);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('T6-05 / AC5 attribution visible and nothing overflows at 390 / 768 / 1440 / 1920 and 200% zoom', async ({ page }) => {
  await signIn(page);
  for (const [name, viewport] of [['390', { width: 390, height: 844 }], ['768', { width: 768, height: 1024 }], ['1440', { width: 1440, height: 900 }],
    // 200% zoom of a 1280px window = a 640 CSS-px layout viewport.
    ['1920', { width: 1920, height: 1080 }], ['zoom200-1280', { width: 640, height: 450 }]] as const) {
    await page.setViewportSize(viewport);
    await openTracking(page, fixtures!.orders.outRoute);
    await mapReady(page);
    const attribution = page.getByRole('link', { name: '© OpenStreetMap contributors' });
    await attribution.scrollIntoViewIfNeeded();
    await expect(attribution).toBeInViewport({ ratio: 1 });
    const map = (await mapRegion(page).boundingBox())!;
    const link = (await attribution.boundingBox())!;
    expect(link.x + link.width).toBeLessThanOrEqual(map.x + map.width + 1);
    expect(link.y + link.height).toBeLessThanOrEqual(map.y + map.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const control of ['Zoom in', 'Zoom out', 'Recenter map']) {
      const box = (await page.getByRole('button', { name: control }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await axe(page)).toEqual([]);
    await panelOf(page).screenshot({ path: path.join(shots, `map-${name}.png`) });
    if (name === '1920' || name === '390') await page.screenshot({ path: path.join(shots, `page-${name}.png`), fullPage: true });
  }
});

test('T6-06 at 390 the page scrolls over the map until "Explore map"; Done returns to the inert map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openTracking(page, fixtures!.orders.outRoute);
  await mapReady(page);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await mapRegion(page).scrollIntoViewIfNeeded();
  const box = (await mapRegion(page).boundingBox())!;
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  await mapRegion(page).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Explore map' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  await expect(mapRegion(page)).toHaveAttribute('tabindex', '0');
  await panelOf(page).screenshot({ path: path.join(shots, 'map-390-exploring.png') });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Explore map' })).toBeVisible();
  await expect(mapRegion(page)).toHaveAttribute('tabindex', '-1');
});

test('T6-07 keyboard: map focusable with a visible ring, + and the 44px buttons zoom, Recenter refits', async ({ page }) => {
  const zooms: number[] = [];
  page.on('request', request => {
    const match = request.url().startsWith(tiles) ? /\/(\d+)\/\d+\/\d+\.svg$/.exec(request.url()) : null;
    if (match) zooms.push(Number(match[1]));
  });
  await signIn(page);
  await openTracking(page, fixtures!.orders.outRoute);
  await mapReady(page);
  const startZoom = Math.max(...zooms);
  await page.locator('#delivery-map-summary').click();
  let focused = false;
  for (let index = 0; index < 12 && !focused; index++) {
    await page.keyboard.press('Tab');
    focused = await mapRegion(page).evaluate(element => element === document.activeElement);
  }
  expect(focused).toBe(true);
  expect(await mapRegion(page).evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await panelOf(page).screenshot({ path: path.join(shots, 'map-keyboard-focus-1440.png') });
  await page.keyboard.press('Equal');
  await expect.poll(() => Math.max(...zooms)).toBeGreaterThan(startZoom);
  const afterKey = Math.max(...zooms);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => Math.max(...zooms)).toBeGreaterThan(afterKey);
  await page.getByRole('button', { name: 'Recenter map' }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
});

test('T6-08 / AC2 network audit: only the app origin and the tile host; no coordinates, address or order data in any URL', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', request => urls.push(request.url()));
  await signIn(page);
  await openTracking(page, fixtures!.orders.outRoute);
  await mapReady(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForLoadState('networkidle');
  const origins = new Set(urls.filter(url => url.startsWith('http')).map(url => new URL(url).origin));
  expect([...origins].sort()).toEqual([new URL(base).origin, tiles].sort());
  const tileUrls = urls.filter(url => url.startsWith(tiles));
  expect(tileUrls.length).toBeGreaterThan(0);
  for (const url of tileUrls) expect(url.slice(tiles.length)).toMatch(/^\/\d+\/\d+\/\d+\.svg$/);
  for (const url of urls) expect(url).not.toMatch(/34\.0\d|-118\.\d|latitude|longitude|Harbor|Alex/i);
});

test('T6-09 simulated fixture: dashed simulated line, "Simulated" legend and caption', async ({ page }) => {
  await signIn(page);
  await openTracking(page, fixtures!.orders.outSimulated);
  await mapReady(page);
  const panel = panelOf(page);
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveAttribute('stroke-dasharray', '8 6');
  await expect(panel.getByRole('list', { name: 'Map legend' })).toContainText('Simulated route');
  await expect(panel).toContainText('Simulated demo route. It is not real delivery data.');
  await expect(panel).toContainText('Simulated demo');
  expect(await axe(page)).toEqual([]);
  await panel.screenshot({ path: path.join(shots, 'map-simulated-1440.png') });
});
