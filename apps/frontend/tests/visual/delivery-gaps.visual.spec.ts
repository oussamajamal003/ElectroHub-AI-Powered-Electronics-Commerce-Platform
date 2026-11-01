import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Tasks 04.5–04.7 browser-acceptance gap closure (P1–P6, M1, M2) on the disposable stack from apps/backend/scripts/delivery-qa-stack.cjs.
 * Faults are confined to that stack: a Chromium WebSocket route (held acknowledgments, closed sockets), a failing REST route, a PostgreSQL
 * row lock held from a second psql session, and a test-only short-lived access token signed with the stack's own throw-away secret.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const pointer = path.join(root, '.cache', 'delivery-qa-stack.current');
type Account = { email: string; password: string };
const state = existsSync(pointer) ? JSON.parse(readFileSync(readFileSync(pointer, 'utf8').trim(), 'utf8')) as { frontend: string; credentials: string; database: string; jwtSecretFile?: string } : null;
const fixtures = state ? JSON.parse(readFileSync(state.credentials, 'utf8')) as { admin: Account; customer: Account; other: Account;
  orders: Record<'liveA' | 'liveSimulation' | 'liveOther' | 'delivered', string> } : null;
const base = state?.frontend ?? 'http://localhost:3310';
const shots = path.resolve(here, '../../screenshots/delivery-gaps');
mkdirSync(shots, { recursive: true });
test.skip(!fixtures?.orders.liveA || !state?.database.startsWith('loopback:'), 'Start apps/backend/scripts/delivery-qa-stack.cjs first.');
test.describe.configure({ mode: 'serial' });

// ---- database (disposable loopback PostgreSQL only) -------------------------------------------------------------------------------
const pgBin = process.env.ELECTROHUB_LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const [, pgPort, pgDatabase] = /^loopback:(\d+)\/(electrohub_disposable_.+)$/.exec(state?.database ?? '') ?? [];
const psqlArgs = ['-h', '127.0.0.1', '-p', pgPort ?? '', '-U', 'postgres', '-d', pgDatabase ?? ''];
function sql(query: string): string {
  const result = spawnSync(path.join(pgBin, 'psql.exe'), [...psqlArgs, '-tAq', '-F', '|', '-c', query], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr.slice(0, 200)}`);
  return result.stdout.trim();
}
const orderId = (reference: string) => reference.slice(4).toLowerCase();
/** Whole-table fingerprints of every commerce table the delivery feature must never touch. */
function commerceFingerprint(): Record<string, string> {
  const tables = sql(`select table_name from information_schema.tables where table_schema='public' and (table_name in ('orders','order_items','payments') or table_name ~ '(outbox|inventor|stock)') order by 1`).split('\n').map(name => name.trim()).filter(Boolean);
  expect(tables.length).toBeGreaterThanOrEqual(3);
  return Object.fromEntries(tables.map(table => [table, sql(`select count(*) || ':' || coalesce(md5(string_agg(t::text, '' order by t::text)), '-') from "${table}" t`)]));
}
const events = (reference: string) => sql(`select revision, type, source, coalesce(latitude::text,'') from delivery_events where "deliveryId" = (select id from deliveries where "orderId"='${orderId(reference)}') order by revision`)
  .split('\n').filter(Boolean).map(line => { const [revision, type, source, latitude] = line.split('|'); return { revision: Number(revision), type: type!, source: source!, latitude: latitude! }; });
const locationSource = (reference: string) => sql(`select coalesce("locationSource"::text,'') from deliveries where "orderId"='${orderId(reference)}'`);

// ---- API helpers ------------------------------------------------------------------------------------------------------------------
let adminToken = '';
async function adminHeaders(request: APIRequestContext) {
  if (!adminToken) {
    const login = await request.post(`${base}/api/auth/login`, { data: { email: fixtures!.admin.email, password: fixtures!.admin.password } });
    expect(login.status()).toBe(200);
    adminToken = (await login.json()).accessToken;
  }
  return { Authorization: `Bearer ${adminToken}` };
}
async function adminPatch(request: APIRequestContext, reference: string, body: Record<string, unknown>) {
  const headers = await adminHeaders(request);
  const snapshot = await request.get(`${base}/api/admin/orders/${reference}/delivery`, { headers });
  const revision = (await snapshot.json()).data.current.revision as number;
  const response = await request.patch(`${base}/api/admin/orders/${reference}/delivery`, { headers, data: { expectedRevision: revision, ...body } });
  expect(response.status()).toBe(200);
}
const hours = (value: number) => new Date(Date.now() + value * 3_600_000).toISOString();
const loginBody = (account: Account) => ({ data: { email: account.email, password: account.password } });

// ---- browser helpers + console/network audit (P6) ---------------------------------------------------------------------------------
type Finding = { scenario: string; kind: string; text: string };
const audit: Finding[] = [];
const visited = new Map<string, number>();
const cancelled: string[] = [];
function watch(page: Page, scenario: string, expected: RegExp[] = []) {
  const record = (kind: string, text: string) => { if (!expected.some(pattern => pattern.test(`${kind} ${text}`))) audit.push({ scenario, kind, text: text.slice(0, 220) }); };
  page.on('console', message => { if (message.type() === 'error') record('console', message.text()); });
  page.on('pageerror', error => record('pageerror', error.message));
  // A GET cancelled by the browser (reload, or React Query restarting an in-flight read on purpose) is counted, not a failure; any other
  // failed request, and any cancelled write, is a finding.
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? '';
    if (request.method() === 'GET' && /ERR_ABORTED/.test(failure)) { cancelled.push(`${scenario} ${new URL(request.url()).pathname}`); return; }
    record('requestfailed', `${request.method()} ${new URL(request.url()).pathname} ${failure}`);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (response.status() >= 400) record('http', `${response.request().method()} ${url.pathname} ${response.status()}`);
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) record('external', `${url.hostname}${url.pathname}`);
    if (/token|password|secret|jwt|authorization/i.test(url.search)) record('sensitive-query', url.pathname);
    if (request.method() === 'GET' && /\/orders\/[^/]+\/delivery$/.test(url.pathname)) { const key = `${scenario}:${url.pathname}`; visited.set(key, (visited.get(key) ?? 0) + 1); }
  });
}
async function newContext(browser: Browser, account: Account, scenario: string, expected: RegExp[] = []): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await context.request.post(`${base}/api/auth/login`, loginBody(account));
  expect(login.status()).toBe(200);
  const page = await context.newPage();
  watch(page, scenario, expected);
  return { context, page };
}
async function openTracking(page: Page, reference: string) {
  await page.goto(`${base}/orders/${reference}/tracking`);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`Track order ${reference}`) })).toBeVisible({ timeout: 20_000 });
}
const livePill = (page: Page) => page.locator('[data-live-state]');
async function recordPill(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(window, '__pill', seen);
    const note = () => { const text = document.querySelector('[data-live-state]')?.textContent ?? ''; if (text && seen[seen.length - 1] !== text) seen.push(text); };
    note();
    new MutationObserver(note).observe(document.body, { childList: true, characterData: true, subtree: true });
  });
}
const pillHistory = (page: Page) => page.evaluate(() => Reflect.get(window, '__pill') as string[]);
async function recordAnnouncements(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('[data-testid="delivery-live-region"]')!;
    const seen: string[] = [];
    Reflect.set(window, '__announcements', seen);
    new MutationObserver(() => { if (region.textContent) seen.push(region.textContent); }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}
const announcements = (page: Page) => page.evaluate(() => Reflect.get(window, '__announcements') as string[]);
const route = (page: Page) => page.locator('.leaflet-overlay-pane path').first();
const timelineItems = (page: Page) => page.locator('section[aria-labelledby="delivery-history-heading"] li').allInnerTexts();
const estimate = (page: Page) => page.locator('section:has-text("Estimated arrival")').first().innerText();
const markers = async (page: Page) => (await page.locator('.leaflet-marker-pane').count()) ? page.locator('.leaflet-marker-pane').innerHTML() : '';
const toasts = (page: Page) => page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Dismiss delivery update' }) });

type ProbeSocket = { on: (event: string, handler: (payload: unknown) => void) => void; once: (event: string, handler: (payload?: never) => void) => void;
  timeout: (ms: number) => { emitWithAck: (event: string, payload: object) => Promise<unknown> }; close: () => void };
// ---- P1 ---------------------------------------------------------------------------------------------------------------------------
test('P1 T45-B06: customer B is denied A\'s tracking page, REST and Socket.IO subscription; nothing of A reaches B', async ({ browser, request }) => {
  const a = await newContext(browser, fixtures!.customer, 'P1-A');
  const b = await newContext(browser, fixtures!.other, 'P1-B', [/http GET \/api\/orders\/ORD-[0-9A-F-]+\/delivery 404/i, /console Failed to load resource.*404/i]);
  const ref = fixtures!.orders.liveA;
  await openTracking(a.page, ref);
  await expect(livePill(a.page)).toHaveText('Live updates on');

  // 1. Page: safe Not Found, no order data.
  await b.page.goto(`${base}/orders/${ref}/tracking`);
  await expect(b.page.getByRole('alert')).toContainText('Order not found', { timeout: 20_000 });
  const body = await b.page.locator('main').innerText();
  expect(body).not.toMatch(/Estimated arrival|Delivery history|Track order ORD/);
  await b.page.screenshot({ path: path.join(shots, 'p1-customer-b-not-found.png') });

  // 2. REST: exactly the same 404 an unknown order gets, and nothing else in the body.
  const login = await b.context.request.post(`${base}/api/auth/login`, loginBody(fixtures!.other));
  const token = (await login.json()).accessToken as string;
  const rest = await b.context.request.get(`${base}/api/orders/${ref}/delivery`, { headers: { Authorization: `Bearer ${token}` } });
  expect(rest.status()).toBe(404);
  const missing = await b.context.request.get(`${base}/api/orders/ORD-00000000-0000-4000-8000-000000000000/delivery`, { headers: { Authorization: `Bearer ${token}` } });
  expect(missing.status()).toBe(404);
  expect(await rest.text()).not.toMatch(/latitude|estimatedAt|trackingCode|revision/);

  // 3. Socket.IO from B's real browser: A's order is NOT_FOUND, B's own order subscribes, and A's later update never arrives.
  await b.page.goto(`${base}/orders/${fixtures!.orders.liveOther}/tracking`);
  await expect(livePill(b.page)).toHaveText('Live updates on', { timeout: 20_000 });
  const probe = await b.page.evaluate(async ({ token: accessToken, mine, theirs }) => {
    // The app's own pre-bundled socket.io-client (the same library version the page uses), driven directly.
    const { io } = await import(/* @vite-ignore */ '/node_modules/.vite/deps/socket__io-client.js') as { io: (url: string, options: object) => ProbeSocket };
    const socket = io('/delivery', { path: '/socket.io', auth: { token: accessToken }, transports: ['websocket'] });
    const received: unknown[] = [];
    socket.on('delivery:updated', (event: unknown) => received.push(event));
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const denied = await socket.timeout(5000).emitWithAck('delivery:subscribe', { orderReference: theirs });
    const own = await socket.timeout(5000).emitWithAck('delivery:subscribe', { orderReference: mine });
    Reflect.set(window, '__probe', { socket, received });
    return { denied, own };
  }, { token, mine: fixtures!.orders.liveOther, theirs: ref });
  expect(probe.denied).toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(probe.own).toMatchObject({ ok: true });
  await adminPatch(request, ref, { estimatedAt: hours(8 + Math.random()) });
  await expect.poll(async () => (await timelineItems(a.page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await a.page.waitForTimeout(1_500);
  const leaked = await b.page.evaluate(() => (Reflect.get(window, '__probe') as { received: unknown[] }).received);
  expect(leaked).toEqual([]);
  await b.page.evaluate(() => (Reflect.get(window, '__probe') as { socket: { close: () => void } }).socket.close());
  await a.context.close(); await b.context.close();
});

// ---- P2 ---------------------------------------------------------------------------------------------------------------------------
test('P2 T47-B02: live ETA and location reach the customer without a refresh; one ETA toast, none for location, no duplicate history', async ({ browser, request }) => {
  const ref = fixtures!.orders.liveSimulation;
  const c = await newContext(browser, fixtures!.customer, 'P2-customer');
  await openTracking(c.page, ref);
  await expect(livePill(c.page)).toHaveText('Live updates on');
  await recordAnnouncements(c.page);
  await expect(c.page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  const etaBefore = await estimate(c.page);
  const historyBefore = await timelineItems(c.page);

  await adminPatch(request, ref, { estimatedAt: hours(9) });
  await expect.poll(() => estimate(c.page), { timeout: 15_000 }).not.toBe(etaBefore);
  await expect.poll(() => announcements(c.page)).toEqual([expect.stringMatching(/^Estimated arrival updated: around /)]);
  await expect(toasts(c.page)).toHaveCount(1);
  await expect(toasts(c.page).first()).toContainText('Estimated arrival updated');
  const historyEta = await timelineItems(c.page);
  expect(historyEta.length).toBe(historyBefore.length + 1);
  expect(new Set(historyEta).size).toBe(historyEta.length);
  await c.page.screenshot({ path: path.join(shots, 'p2-eta-live-toast.png'), fullPage: true });

  // Location-only ticks: the marker/route move, nothing is announced or toasted, history grows by at most the one recorded event each.
  const noToasts = await toasts(c.page).count();
  for (const [latitude, longitude] of [[34.06, -118.25], [34.07, -118.24]] as const) {
    const historyPrior = await timelineItems(c.page);
    const priorMarker = await markers(c.page);
    await adminPatch(request, ref, { location: { latitude, longitude, label: null } });
    await expect.poll(async () => (await markers(c.page)) !== priorMarker || (await timelineItems(c.page)).length > historyPrior.length, { timeout: 15_000 }).toBe(true);
    await c.page.waitForTimeout(800);
    const historyNow = await timelineItems(c.page);
    expect(historyNow.length - historyPrior.length).toBeLessThanOrEqual(1);
    expect(new Set(historyNow).size).toBe(historyNow.length);
  }
  expect(await toasts(c.page).count()).toBeLessThanOrEqual(noToasts);
  expect(await announcements(c.page)).toHaveLength(1);
  await expect(c.page.locator('.leaflet-container')).toBeVisible();
  const finalPath = await route(c.page).getAttribute('d');
  expect(finalPath).toBeTruthy();

  // The page and the database agree after a reload.
  const etaLive = await estimate(c.page); const historyLive = await timelineItems(c.page);
  await c.page.reload();
  await expect(livePill(c.page)).toHaveText('Live updates on', { timeout: 20_000 });
  expect(await estimate(c.page)).toBe(etaLive);
  expect(await timelineItems(c.page)).toEqual(historyLive);
  // Pixel paths depend on map framing, so persistence is checked on the stored coordinates: the latest location event is the last patch.
  await expect(c.page.locator('.leaflet-container')).toBeVisible();
  expect(Number(events(ref).filter(event => event.type === 'LOCATION_UPDATED' && event.source === 'ADMIN').at(-1)!.latitude)).toBeCloseTo(34.07, 5);
  await c.context.close();
});

// ---- P3 ---------------------------------------------------------------------------------------------------------------------------
test('P3 T47-B05: an obsolete acknowledgment and a failed reconciliation never mark the page live; a later good read does', async ({ browser, request }) => {
  test.setTimeout(170_000);
  const ref = fixtures!.orders.liveA;
  const c = await newContext(browser, fixtures!.customer, 'P3-customer', [/requestfailed/i, /http GET .*\/delivery 5\d\d/i, /console Failed to load resource.*500/i]);
  let phase: 'pass' | 'hold-ack' | 'stale-inject' | 'refuse' = 'pass';
  let restFails = false;
  const heldAcks: string[] = [];
  const sockets: { close: (o: { code: number }) => void }[] = [];
  await c.context.routeWebSocket(/\/socket\.io\//, ws => {
    if (phase === 'refuse') { void ws.close({ code: 4000, reason: 'down' }); return; }
    const server = ws.connectToServer();
    sockets.push(ws as never);
    if (phase === 'stale-inject') for (const frame of heldAcks) setTimeout(() => ws.send(frame), 300);
    ws.onMessage(message => server.send(message));
    server.onMessage(message => {
      if (phase === 'hold-ack' && typeof message === 'string' && /^43\/delivery,\d+\[/.test(message)) { heldAcks.push(message); return; }
      ws.send(message);
    });
  });
  await c.context.route(`**/api/orders/${ref}/delivery`, r => restFails ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' }) : r.continue());

  phase = 'hold-ack';                                   // the subscribe acknowledgment is held back
  await c.page.goto(`${base}/orders/${ref}/tracking`);
  await expect(c.page.getByRole('heading', { level: 1, name: new RegExp(`Track order ${ref}`) })).toBeVisible({ timeout: 20_000 });
  await recordPill(c.page);
  await expect.poll(() => heldAcks.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await c.page.waitForTimeout(1_000);
  expect(await livePill(c.page).textContent()).not.toBe('Live updates on');   // an unacknowledged subscription is never "live"

  restFails = true;                                      // the reconciliation after reconnect will fail (set before the cut: no race)
  phase = 'stale-inject';                                // drop the connection, reconnect, replay the old ack (original id) into the new connection
  for (const ws of sockets.splice(0)) ws.close({ code: 4000 });
  await expect.poll(async () => (await pillHistory(c.page)).some(text => /reconnecting|paused|connecting/i.test(text)), { timeout: 15_000 }).toBe(true);
  await adminPatch(request, ref, { estimatedAt: hours(10 + Math.random()) });   // changes while the page was cut off
  await expect(livePill(c.page)).toHaveText(/Live updates|Live/, { timeout: 25_000 }).catch(() => undefined);
  await c.page.waitForTimeout(3_000);
  const afterFailedRead = await livePill(c.page).textContent();
  expect(afterFailedRead).not.toMatch(/^Live updates on$/);   // acked + failed REST read: truthful, not live

  restFails = false;                                     // polling (60 s) now succeeds and completes the reconciliation
  await expect(livePill(c.page)).toHaveText(/Live updates on|Live updates restored|Resynced/i, { timeout: 90_000 });
  const latestEta = await estimate(c.page);
  const apiEta = (await (await c.context.request.get(`${base}/api/orders/${ref}/delivery`, { headers: { Authorization: `Bearer ${(await (await c.context.request.post(`${base}/api/auth/refresh`)).json()).accessToken}` } })).json()).data.eta.estimatedAt as string;
  expect(apiEta).toBeTruthy();
  expect(latestEta.length).toBeGreaterThan(0);
  await c.page.screenshot({ path: path.join(shots, 'p3-resynced.png') });
  phase = 'pass';
  await c.context.close();
});

// ---- P4 + M2 ----------------------------------------------------------------------------------------------------------------------
test('P4 T47-B06 + M2 TALL-B06: admin ETA, location and a UI-driven simulation change only delivery data; commerce tables are byte-identical', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const ref = fixtures!.orders.liveSimulation;
  const baseline = commerceFingerprint();
  const eventsBefore = events(ref);
  const customer = await newContext(browser, fixtures!.customer, 'P4-customer');
  const admin = await newContext(browser, fixtures!.admin, 'P4-admin');
  await openTracking(customer.page, ref);
  await adminPatch(request, ref, { estimatedAt: hours(3) });
  await adminPatch(request, ref, { location: { latitude: 34.05, longitude: -118.26, label: null } });
  expect(commerceFingerprint()).toEqual(baseline);

  await admin.page.goto(`${base}/admin/deliveries/${ref}`);
  await expect(admin.page.getByRole('heading', { name: 'Demo tools' })).toBeVisible({ timeout: 20_000 });
  await admin.page.getByRole('button', { name: 'Start simulation' }).click();
  await expect(admin.page.getByRole('button', { name: 'Stop simulation' })).toBeVisible({ timeout: 15_000 });
  const ticksBefore = events(ref).filter(event => event.source === 'SIMULATION' && event.type === 'LOCATION_UPDATED').length;
  const ticks = () => events(ref).filter(event => event.source === 'SIMULATION' && event.type !== 'SIMULATION_STARTED' && event.type !== 'SIMULATION_STOPPED');
  await expect.poll(() => ticks().length - ticksBefore, { timeout: 40_000, intervals: [1_000] }).toBeGreaterThanOrEqual(2);
  const panel = customer.page.locator('section[aria-labelledby="delivery-location-heading"]');
  await expect(panel).toContainText('Simulated demo', { timeout: 15_000 });
  expect(locationSource(ref)).toBe('SIMULATED');
  expect(await route(customer.page).getAttribute('stroke-dasharray')).not.toBeNull();
  await customer.page.screenshot({ path: path.join(shots, 'p4-simulation-customer.png'), fullPage: true });
  await admin.page.getByRole('button', { name: 'Stop simulation' }).click();
  await expect(admin.page.getByRole('button', { name: 'Start simulation' })).toBeVisible({ timeout: 15_000 });

  const eventsAfter = events(ref);
  const added = eventsAfter.slice(eventsBefore.length);
  expect(added.map(event => event.revision)).toEqual(added.map((_, index) => eventsBefore.length ? eventsBefore[eventsBefore.length - 1]!.revision + 1 + index : index + 1));
  expect(added.map(event => event.type)).toContain('SIMULATION_STARTED');
  expect(added.at(-1)!.type).toBe('SIMULATION_STOPPED');
  expect(added.filter(event => event.source === 'SIMULATION' && event.type === 'LOCATION_UPDATED').length).toBeGreaterThanOrEqual(2);
  expect(added.filter(event => event.type === 'LOCATION_UPDATED' && event.source === 'ADMIN').length).toBe(1);
  expect(commerceFingerprint()).toEqual(baseline);
  await customer.page.reload(); await admin.page.reload();
  await expect(livePill(customer.page)).toHaveText(/Live updates|Updates/, { timeout: 20_000 });
  expect(commerceFingerprint()).toEqual(baseline);
  await customer.context.close(); await admin.context.close();
});

// ---- M1 ---------------------------------------------------------------------------------------------------------------------------
test('M1 T47-B07: Stop during a held tick waits for it, records STOPPED after the last location, and the customer sees no later movement', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const ref = fixtures!.orders.liveSimulation;
  const customer = await newContext(browser, fixtures!.customer, 'M1-customer');
  const admin = await newContext(browser, fixtures!.admin, 'M1-admin');
  await openTracking(customer.page, ref);
  await admin.page.goto(`${base}/admin/deliveries/${ref}`);
  await expect(admin.page.getByRole('heading', { name: 'Demo tools' })).toBeVisible({ timeout: 20_000 });
  await admin.page.getByRole('button', { name: 'Start simulation' }).click();
  await expect(admin.page.getByRole('button', { name: 'Stop simulation' })).toBeVisible({ timeout: 15_000 });
  const simulatedLocations = () => events(ref).filter(event => event.source === 'SIMULATION' && event.type === 'LOCATION_UPDATED');
  const countBefore = simulatedLocations().length;
  await expect.poll(() => simulatedLocations().length, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(countBefore);

  // Hold the delivery row from a second session: the next tick starts, then blocks on the row lock before it can commit.
  const holder = spawn(path.join(pgBin, 'psql.exe'), [...psqlArgs, '-tAq'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let holderOut = '';
  holder.stdout.on('data', chunk => { holderOut += String(chunk); });
  holder.stdin.write(`BEGIN; SELECT 'LOCKED' FROM deliveries WHERE "orderId"='${orderId(ref)}' FOR UPDATE;\n`);
  await expect.poll(() => holderOut, { timeout: 10_000 }).toContain('LOCKED');
  const waiting = () => Number(sql(`select count(*) from pg_stat_activity where datname='${pgDatabase}' and wait_event_type='Lock' and pid <> pg_backend_pid()`));
  await expect.poll(waiting, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(0);          // a tick is genuinely in flight
  const locationsAtHold = simulatedLocations().length;
  const pathAtHold = await route(customer.page).getAttribute('d');

  let stopResponded = false;
  const stopResponse = admin.page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes('/delivery/simulation'), { timeout: 60_000 })
    .then(response => { stopResponded = true; return response; });
  await admin.page.getByRole('button', { name: 'Stop simulation' }).click();
  await admin.page.waitForTimeout(3_000);
  expect(stopResponded).toBe(false);                                                             // Stop has not completed while the tick is held
  expect(events(ref).some(event => event.type === 'SIMULATION_STOPPED' && event.revision > (simulatedLocations().at(-1)?.revision ?? 0))).toBe(false);
  expect(simulatedLocations().length).toBe(locationsAtHold);

  holder.stdin.write('ROLLBACK;\n\\q\n');                                                         // release the tick
  const response = await stopResponse;
  expect(response.status()).toBe(200);
  const after = events(ref);
  const stopped = after.filter(event => event.type === 'SIMULATION_STOPPED').at(-1)!;
  const lastLocation = simulatedLocations().at(-1)!;
  expect(stopped.revision).toBeGreaterThan(lastLocation.revision);                              // STOPPED follows the last permitted location
  expect(simulatedLocations().length).toBeLessThanOrEqual(locationsAtHold + 1);
  await customer.page.waitForTimeout(7_000);                                                     // longer than one tick interval
  expect(events(ref)).toEqual(after);                                                            // nothing moved after STOPPED
  const pathAfter = await route(customer.page).getAttribute('d');
  await customer.page.reload(); await admin.page.reload();
  await expect(livePill(customer.page)).toBeVisible({ timeout: 20_000 });
  expect(await route(customer.page).getAttribute('d')).toBe(pathAfter);
  expect(pathAfter === pathAtHold || simulatedLocations().length === locationsAtHold + 1).toBe(true);
  await expect(admin.page.getByRole('button', { name: 'Start simulation' })).toBeVisible({ timeout: 15_000 });
  const repeat = await request.delete(`${base}/api/admin/orders/${ref}/delivery/simulation`, { headers: await adminHeaders(request) });
  expect(repeat.status()).toBe(200);
  expect(events(ref)).toEqual(after);                                                            // second Stop is an idempotent no-op
  await customer.page.screenshot({ path: path.join(shots, 'm1-after-stop-customer.png'), fullPage: true });
  await customer.context.close(); await admin.context.close();
});

// ---- P5 ---------------------------------------------------------------------------------------------------------------------------
const requireBackend = createRequire(path.join(root, 'apps/backend/package.json'));
function shortToken(realToken: string, seconds: number) {
  const jwt = requireBackend('jsonwebtoken') as typeof import('jsonwebtoken');
  const claims = jwt.decode(realToken) as { userId: string; role: string };
  const secret = readFileSync(state!.jwtSecretFile!, 'utf8');
  return jwt.sign({ userId: claims.userId, role: claims.role }, secret, { algorithm: 'HS256', expiresIn: seconds });
}
async function shortLivedSession(browser: Browser, scenario: string, refreshAfterExpiry: 'real' | 'reject') {
  const { context, page } = await newContext(browser, fixtures!.customer, scenario, refreshAfterExpiry === 'reject' ? [/http POST \/api\/auth\/refresh 401/i] : []);
  let refreshes = 0;
  await context.route('**/api/auth/refresh', async r => {
    refreshes++;
    if (refreshes === 1) {
      const real = await r.fetch();
      const body = await real.json() as { accessToken: string };
      await r.fulfill({ response: real, json: { ...body, accessToken: shortToken(body.accessToken, 12) } });
    } else if (refreshAfterExpiry === 'reject') await r.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false,"message":"Session expired"}' });
    else await r.continue();
  });
  const frames: string[] = [];
  page.on('websocket', ws => ws.on('framereceived', frame => frames.push(String(frame.payload))));
  return { context, page, frames, refreshes: () => refreshes };
}
test('P5 TALL-B04: real expiry of a test-only short-lived token — session:expired, refresh, reconnect, owner-scoped reconcile', async ({ browser }) => {
  test.setTimeout(90_000);
  const ref = fixtures!.orders.liveA;
  const s = await shortLivedSession(browser, 'P5-renew', 'real');
  await openTracking(s.page, ref);
  await expect(livePill(s.page)).toHaveText('Live updates on');
  await recordPill(s.page);
  const readsBefore = visited.get(`P5-renew:/api/orders/${ref}/delivery`) ?? 0;
  await expect.poll(() => s.frames.some(frame => frame.includes('session:expired')), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => s.refreshes(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(livePill(s.page)).toHaveText('Live updates on', { timeout: 30_000 });
  expect(await pillHistory(s.page)).toEqual(expect.arrayContaining([expect.stringMatching(/reconnecting|connecting|restored|resynced|live updates on/i)]));
  expect(new URL(s.page.url()).pathname).toBe(`/orders/${ref}/tracking`);
  await expect(s.page.getByRole('heading', { level: 1, name: new RegExp(`Track order ${ref}`) })).toBeVisible();
  expect((visited.get(`P5-renew:/api/orders/${ref}/delivery`) ?? 0)).toBeGreaterThan(readsBefore);   // owner-scoped REST re-read after the renewed session
  await s.page.screenshot({ path: path.join(shots, 'p5-renewed.png') });
  await s.context.close();
});
test('P5b TALL-B04: refresh failure after expiry leaves a safe, non-live page', async ({ browser }) => {
  test.setTimeout(90_000);
  const ref = fixtures!.orders.liveA;
  const s = await shortLivedSession(browser, 'P5-fail', 'reject');
  await openTracking(s.page, ref);
  await expect(livePill(s.page)).toHaveText('Live updates on');
  await expect.poll(() => s.frames.some(frame => frame.includes('session:expired')), { timeout: 30_000 }).toBe(true);
  await s.page.waitForTimeout(4_000);
  // The failed refresh ends the session: the page shows the sign-in-required state and no order data or live pill remains.
  await expect(s.page.getByRole('heading', { level: 1, name: 'Sign In Required' })).toBeVisible({ timeout: 15_000 });
  expect(await livePill(s.page).count()).toBe(0);
  expect(await s.page.locator('body').innerText()).not.toMatch(/Estimated arrival|Delivery history/);
  await s.page.screenshot({ path: path.join(shots, 'p5b-refresh-failed.png') });
  await s.context.close();
});

// ---- P6 ---------------------------------------------------------------------------------------------------------------------------
test('P6 TALL-B05: console and network audit across the representative scenarios', async () => {
  const unexpected = audit.filter(entry => !/^P5-fail/.test(entry.scenario));
  console.log(`AUDIT scenarios: ${[...new Set(audit.map(entry => entry.scenario))].join(', ') || '(none with findings)'}`);
  console.log(`AUDIT findings: ${JSON.stringify(unexpected, null, 1)}`);
  console.log(`AUDIT cancelled GETs (reload / deliberate read restart): ${cancelled.length}`);
  console.log(`AUDIT tracking GETs per page: ${JSON.stringify([...visited.entries()])}`);
  expect(unexpected).toEqual([]);
  for (const [, count] of visited) expect(count).toBeLessThanOrEqual(12);
});
