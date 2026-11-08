import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * Task 04.7 real Chromium multi-context QA (T7-03, T7-05, T7-07, T7-09, T7-11, AC3–AC6) against the disposable stack from
 * apps/backend/scripts/delivery-qa-stack.cjs (local tile stub, DELIVERY_SIMULATION_ENABLED on its own disposable database). Updates come
 * from the real admin API and the real simulation runner; the only injected faults are Chromium offline emulation and a blocked socket route.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const pointer = path.join(root, '.cache', 'delivery-qa-stack.current');
const state = existsSync(pointer) ? JSON.parse(readFileSync(readFileSync(pointer, 'utf8').trim(), 'utf8')) as { frontend: string; tiles?: string; credentials: string } : null;
type Account = { email: string; password: string };
const fixtures = state ? JSON.parse(readFileSync(state.credentials, 'utf8')) as { admin: Account; customer: Account; other: Account;
  orders: Record<'liveA' | 'liveSimulation' | 'liveOther' | 'delivered', string> } : null;
const base = state?.frontend ?? 'http://localhost:3310';
const shots = path.resolve(here, '../../screenshots/delivery-04.7');
mkdirSync(shots, { recursive: true });

test.skip(!fixtures?.orders.liveA, 'Start apps/backend/scripts/delivery-qa-stack.cjs first (disposable QA stack with the 04.7 fixtures).');
test.describe.configure({ mode: 'serial' });

let adminToken = '';
async function adminApi(request: APIRequestContext) {
  if (!adminToken) {
    const login = await request.post(`${base}/api/auth/login`, { data: { email: fixtures!.admin.email, password: fixtures!.admin.password } });
    expect(login.status()).toBe(200);
    adminToken = (await login.json()).accessToken;
  }
  return { Authorization: `Bearer ${adminToken}` };
}
async function adminSnapshot(request: APIRequestContext, reference: string) {
  const response = await request.get(`${base}/api/admin/orders/${reference}/delivery`, { headers: await adminApi(request) });
  return (await response.json()).data as { current: { revision: number } };
}
async function adminPatch(request: APIRequestContext, reference: string, body: Record<string, unknown>) {
  const { current } = await adminSnapshot(request, reference);
  const response = await request.patch(`${base}/api/admin/orders/${reference}/delivery`, { headers: await adminApi(request), data: { expectedRevision: current.revision, ...body } });
  expect(response.status()).toBe(200);
  return (await response.json()).data as { current: { revision: number } };
}
const hours = (value: number) => new Date(Date.now() + value * 3_600_000).toISOString();

async function customerContext(browser: Browser, account: Account): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await context.request.post(`${base}/api/auth/login`, { data: { email: account.email, password: account.password } });
  expect(login.status()).toBe(200);
  return context;
}
async function openTracking(page: Page, reference: string) {
  await page.goto(`${base}/orders/${reference}/tracking`);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`Track order ${reference}`) })).toBeVisible({ timeout: 20_000 });
}

/**
 * A network outage the browser really experiences: every Socket.IO WebSocket is proxied to the real server, so going "offline" closes the
 * open socket and refuses new socket and API requests until "online" again. (Chromium offline emulation does not cut an open loopback socket.)
 */
async function outage(context: BrowserContext) {
  let online = true;
  const open = new Set<WebSocketRoute>();
  await context.routeWebSocket(/\/socket\.io\//, ws => {
    if (!online) { void ws.close({ code: 4000, reason: 'offline' }); return; }
    ws.connectToServer();
    open.add(ws);
    ws.onClose(() => { open.delete(ws); });
  });
  await context.route(/\/(socket\.io|api)\//, route => online ? route.continue() : route.abort('internetdisconnected'));
  return { set(value: boolean) { online = value; if (!value) for (const ws of open) void ws.close({ code: 4000, reason: 'offline' }); } };
}
const livePill = (page: Page) => page.locator('[data-live-state]');
async function axe(page: Page) {
  await page.addScriptTag({ content: readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
  return page.evaluate(async () => (await Reflect.get(window, 'axe').run(document.querySelector('main') ?? document,
    { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`));
}
/** Every live-region text the page ever showed, recorded in the page so short-lived announcements are not missed. */
async function recordAnnouncements(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('[data-testid="delivery-live-region"]')!;
    const seen: string[] = [];
    Reflect.set(window, '__announcements', seen);
    new MutationObserver(() => { if (region.textContent) seen.push(region.textContent); }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}
const announcements = (page: Page) => page.evaluate(() => Reflect.get(window, '__announcements') as string[]);

test('T7-03 / T7-09 / AC3: two tabs of one customer update once in place; the other customer never sees the event', async ({ browser, request }) => {
  const a = await customerContext(browser, fixtures!.customer);
  const b = await customerContext(browser, fixtures!.other);
  const tab1 = await a.newPage(); const tab2 = await a.newPage(); const other = await b.newPage();
  const frames: string[] = [];
  other.on('websocket', ws => ws.on('framereceived', frame => frames.push(String(frame.payload))));
  await openTracking(tab1, fixtures!.orders.liveA); await openTracking(tab2, fixtures!.orders.liveA); await openTracking(other, fixtures!.orders.liveOther);
  for (const page of [tab1, tab2, other]) await expect(livePill(page)).toHaveText('Live updates on');
  for (const page of [tab1, tab2]) await recordAnnouncements(page);
  const requestsBefore = { tab1: 0 };
  tab1.on('request', req => { if (req.url().includes('/delivery')) requestsBefore.tab1++; });

  // An ETA change is a customer-visible change on every run (status changes are covered by the hook and PG suites).
  await adminPatch(request, fixtures!.orders.liveA, { estimatedAt: hours(7 + Math.random()) });
  for (const page of [tab1, tab2]) await expect.poll(() => announcements(page)).toEqual([expect.stringMatching(/^Estimated arrival updated: around /)]);
  // A toast appears (visual only, announce-excluded); location ticks never toast.
  await expect(tab1.locator('[data-radix-toast-announce-exclude]').first()).toContainText('Estimated arrival updated');
  await tab1.screenshot({ path: path.join(shots, 'live-two-tabs-tab1-1440.png'), fullPage: true });
  // Merged in place: no REST refetch was needed for the next revision.
  expect(requestsBefore.tab1).toBe(0);
  await expect(livePill(other)).toHaveText('Live updates on');
  expect(frames.filter(frame => frame.includes(fixtures!.orders.liveA))).toEqual([]);
  expect(frames.filter(frame => frame.includes('delivery:updated'))).toEqual([]);
  await a.close(); await b.close();
});

test('simulation: labelled "Simulated demo", the map updates in place without remounting, and the other customer gets nothing', async ({ browser, request }) => {
  const a = await customerContext(browser, fixtures!.customer);
  const b = await customerContext(browser, fixtures!.other);
  const page = await a.newPage(); const other = await b.newPage();
  const frames: string[] = [];
  other.on('websocket', ws => ws.on('framereceived', frame => frames.push(String(frame.payload))));
  await openTracking(page, fixtures!.orders.liveSimulation); await openTracking(other, fixtures!.orders.liveOther);
  await expect(livePill(page)).toHaveText('Live updates on');
  const start = await request.post(`${base}/api/admin/orders/${fixtures!.orders.liveSimulation}/delivery/simulation`, { headers: await adminApi(request),
    data: { routeId: 'demo-hub-north' } });
  expect(start.status()).toBe(201);
  const panel = page.locator('section[aria-labelledby="delivery-location-heading"]');
  await expect(panel).toContainText('Simulated demo', { timeout: 15_000 });
  await expect(panel).toContainText('Simulated position', { timeout: 15_000 });
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => { Reflect.set(document.querySelector('.leaflet-container')!, '__mark', 'first'); });
  const before = await page.locator('.leaflet-overlay-pane path').getAttribute('d');
  // Next tick (≥ 5 s): the same Leaflet container, a longer dashed simulated line.
  await expect.poll(async () => page.locator('.leaflet-overlay-pane path').getAttribute('d'), { timeout: 15_000 }).not.toBe(before);
  expect(await page.evaluate(() => Reflect.get(document.querySelector('.leaflet-container')!, '__mark'))).toBe('first');
  expect(await page.locator('.leaflet-overlay-pane path').getAttribute('stroke-dasharray')).not.toBeNull();
  await panel.screenshot({ path: path.join(shots, 'simulation-map-1440.png') });
  const stop = await request.delete(`${base}/api/admin/orders/${fixtures!.orders.liveSimulation}/delivery/simulation`, { headers: await adminApi(request) });
  expect(stop.status()).toBe(200);
  expect(frames.filter(frame => frame.includes('delivery:updated'))).toEqual([]);

  // Admin Demo tools section renders on the detail page.
  const adminPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await adminPage.context().request.post(`${base}/api/auth/login`, { data: { email: fixtures!.admin.email, password: fixtures!.admin.password } });
  await adminPage.goto(`${base}/admin/deliveries/${fixtures!.orders.liveSimulation}`);
  await expect(adminPage.getByRole('heading', { name: 'Demo tools' })).toBeVisible({ timeout: 20_000 });
  await expect(adminPage.getByRole('button', { name: 'Start simulation' })).toBeEnabled();
  await adminPage.getByRole('heading', { name: 'Demo tools' }).scrollIntoViewIfNeeded();
  await adminPage.screenshot({ path: path.join(shots, 'admin-demo-tools-1440.png'), fullPage: true });
  expect(await axe(adminPage)).toEqual([]);
  await adminPage.context().close();
  await a.close(); await b.close();
});

test('T7-07 / AC4: 30 s offline while 3 updates happen → paused (announced) → back online shows the current revision after one REST read', async ({ browser, request }) => {
  const a = await customerContext(browser, fixtures!.customer);
  const network = await outage(a);
  const page = await a.newPage();
  await openTracking(page, fixtures!.orders.liveA);
  await expect(livePill(page)).toHaveText('Live updates on');
  await recordAnnouncements(page);
  const offlineAt = Date.now();
  network.set(false);
  await expect(livePill(page)).toHaveText(/Reconnecting…|Live updates paused/, { timeout: 30_000 });
  await expect(livePill(page)).toHaveText('Live updates paused', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'live-paused-1440.png'), fullPage: true });
  let latest = 0;
  for (const value of [3, 4, 5]) latest = (await adminPatch(request, fixtures!.orders.liveA, { estimatedAt: hours(value) })).current.revision;
  await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - offlineAt)));
  const reads: number[] = [];
  page.on('response', async response => {
    if (response.url().endsWith(`/api/orders/${fixtures!.orders.liveA}/delivery`) && response.status() === 200) reads.push((await response.json()).data.revision);
  });
  const onlineAt = Date.now();
  network.set(true);
  await expect(livePill(page)).toHaveText(/Back online · up to date|Live updates on/, { timeout: 30_000 });
  // AC4: the first REST read after reconnecting already carries the current revision.
  await expect.poll(() => reads[0], { timeout: 15_000 }).toBe(latest);
  console.log(`T7-07 offline ${Math.round((onlineAt - offlineAt) / 1000)} s; resynced to revision ${latest} in ${Date.now() - onlineAt} ms`);
  const heard = await announcements(page);
  expect(heard.filter(text => text.startsWith('Live updates paused'))).toHaveLength(1);
  expect(heard.at(-1)).toBe('Live updates restored. Tracking is up to date.');
  await a.close();
});

test('T7-11: socket endpoint unavailable → REST still renders, "Live updates paused", Refresh now re-reads REST', async ({ browser }) => {
  const a = await customerContext(browser, fixtures!.customer);
  const page = await a.newPage();
  // The socket endpoint is down: WebSocket upgrades are refused and long-polling fails; REST stays up.
  await page.routeWebSocket(/\/socket\.io\//, ws => { void ws.close({ code: 4000, reason: 'unavailable' }); });
  await page.route(/\/socket\.io\//, route => route.abort('connectionrefused'));
  await openTracking(page, fixtures!.orders.liveA);
  await expect(livePill(page)).toHaveText('Live updates paused', { timeout: 30_000 });
  const read = page.waitForResponse(response => response.url().includes(`/api/orders/${fixtures!.orders.liveA}/delivery`));
  await page.getByRole('button', { name: 'Refresh now' }).click();
  expect((await read).status()).toBe(200);
  await a.close();
});

test('T7-05 / AC6: logout disconnects the live socket server-side; another account in the same browser sees only its own data', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  expect((await context.request.post(`${base}/api/auth/login`, { data: { email: fixtures!.customer.email, password: fixtures!.customer.password } })).status()).toBe(200);
  const page = await context.newPage();
  const closed: string[] = [];
  page.on('websocket', ws => ws.on('close', () => closed.push(ws.url())));
  await openTracking(page, fixtures!.orders.liveA);
  await expect(livePill(page)).toHaveText('Live updates on');
  await page.screenshot({ path: path.join(shots, 'live-on-390.png'), fullPage: true });
  // Sign out through the app's own transport so the server-side hook runs.
  await page.evaluate(async () => { await fetch('/api/auth/customer/logout', { method: 'POST', credentials: 'include' }); });
  await expect.poll(() => closed.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  expect((await context.request.post(`${base}/api/auth/login`, { data: { email: fixtures!.other.email, password: fixtures!.other.password } })).status()).toBe(200);
  await page.goto(`${base}/orders/${fixtures!.orders.liveA}/tracking`);
  await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
  await openTracking(page, fixtures!.orders.liveOther);
  await expect(livePill(page)).toHaveText('Live updates on');
  await expect(page.locator('main')).not.toContainText(fixtures!.orders.liveA);
  await context.close();
});

test('responsive + axe: live pill and paused banner at 390 / 768 / 1440 / 1920 and 200% zoom, no horizontal overflow', async ({ browser }) => {
  const a = await customerContext(browser, fixtures!.customer);
  const network = await outage(a);
  const page = await a.newPage();
  await openTracking(page, fixtures!.orders.liveA);
  await expect(livePill(page)).toHaveText('Live updates on');
  for (const [name, viewport] of [['390', { width: 390, height: 844 }], ['768', { width: 768, height: 1024 }], ['1440', { width: 1440, height: 900 }],
    ['1920', { width: 1920, height: 1080 }], ['zoom200-1280', { width: 640, height: 450 }]] as const) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: path.join(shots, `live-on-${name}.png`), fullPage: true });
  }
  network.set(false);
  await expect(livePill(page)).toHaveText('Live updates paused', { timeout: 30_000 });
  for (const [name, viewport] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }], ['zoom200-1280', { width: 640, height: 450 }]] as const) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const button = page.getByRole('button', { name: 'Refresh now' });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: path.join(shots, `live-paused-${name}.png`), fullPage: true });
  }
  network.set(true);
  await a.close();
});

test('delivered order: "Updates stopped (delivered)" and no socket is opened', async ({ browser }) => {
  const a = await customerContext(browser, fixtures!.customer);
  const page = await a.newPage();
  const sockets: string[] = [];
  page.on('websocket', ws => { if (ws.url().includes('/socket.io/')) sockets.push(ws.url()); });
  await openTracking(page, fixtures!.orders.delivered);
  await expect(livePill(page)).toHaveText('Updates stopped (delivered)');
  await page.waitForTimeout(1500);
  expect(sockets).toEqual([]);
  await a.close();
});
