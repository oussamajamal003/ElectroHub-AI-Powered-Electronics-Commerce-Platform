import { expect, test, type Frame, type Page, type Request, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMainDevRuntime } from './global-setup';

type Fixture = {
  email: string;
  password: string;
  userId: string;
  productId: string;
  productSlug: string;
};

const specDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(specDirectory, '../../../backend');
const acceptanceDirectory = path.join(backendDirectory, '.cache/task04-acceptance');
const fixturePath = path.join(acceptanceDirectory, 'fixture.json');
const statePath = path.join(acceptanceDirectory, 'fixture.state.json');
const outputDirectory = path.resolve(specDirectory, '../../test-results/task04-dev');
const CARD_OK = '4242424242424242';

function parseFixture(value: unknown): Fixture {
  if (!value || typeof value !== 'object') throw new Error('Private Task04 fixture is malformed.');
  const fixture = value as Partial<Fixture>;
  if (typeof fixture.email !== 'string' || typeof fixture.password !== 'string' ||
      typeof fixture.userId !== 'string' || typeof fixture.productId !== 'string' ||
      typeof fixture.productSlug !== 'string') throw new Error('Private Task04 fixture is malformed.');
  return fixture as Fixture;
}

async function loadFixture(): Promise<Fixture> {
  try { return parseFixture(JSON.parse(await readFile(fixturePath, 'utf8'))); }
  catch { throw new Error('Private Task04 fixture is unavailable or malformed.'); }
}

async function writeProgress(state: Record<string, unknown>): Promise<void> {
  const existing = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
  const temporary = path.join(acceptanceDirectory, `.fixture.state.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify({ ...existing, ...state }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, statePath);
}

type ApiMeasurement = { path: string; durationMs: number };
function monitorApi(page: Page) {
  const started = new WeakMap<Request, number>();
  const measurements: ApiMeasurement[] = [];
  const documentMethods: string[] = [];
  let submitCount = 0;
  let attemptId: string | null = null;
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (request.method() === 'GET') started.set(request, performance.now());
    if (/^\/api\/orders\/[^/]+\/documents\//.test(url.pathname) && request.method() !== 'GET') documentMethods.push(request.method());
    const match = url.pathname.match(/^\/api\/checkout\/payment-attempts\/([0-9a-f-]{36})\/submit$/i);
    if (match) { submitCount += 1; attemptId = match[1]; }
  });
  page.on('response', response => {
    const request = response.request();
    const start = started.get(request);
    if (start === undefined) return;
    const url = new URL(response.url());
    const safePath = url.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
    measurements.push({ path: safePath, durationMs: Math.max(0, Math.round(performance.now() - start)) });
  });
  return {
    measurements,
    documentMethods,
    submission: () => ({ count: submitCount, attemptId }),
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

async function savePerformance(measurements: ApiMeasurement[]): Promise<void> {
  const grouped = new Map<string, ApiMeasurement[]>();
  for (const entry of measurements) grouped.set(entry.path, [...(grouped.get(entry.path) ?? []), entry]);
  const apiGets = [...grouped].map(([apiPath, entries]) => ({
    path: apiPath,
    count: entries.length,
    p50Ms: percentile(entries.map(entry => entry.durationMs), 0.5),
    p95Ms: percentile(entries.map(entry => entry.durationMs), 0.95),
  })).sort((a, b) => a.path.localeCompare(b.path));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'performance.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), apiGets }, null, 2)}\n`, { mode: 0o600 });
}

function apiPath(response: { url(): string }): string {
  return new URL(response.url()).pathname;
}

async function requireFixtureUser(response: Response, fixture: Fixture): Promise<{ firstName: string; lastName: string }> {
  const current = (await response.json())?.user;
  if (!response.ok() || current?.id !== fixture.userId || current?.role !== 'CUSTOMER' ||
      typeof current?.firstName !== 'string' || typeof current?.lastName !== 'string') {
    throw new Error('The browser session did not restore as the private synthetic customer fixture.');
  }
  return { firstName: current.firstName, lastName: current.lastName };
}

async function gotoAsFixture(page: Page, path: string, fixture: Fixture): Promise<void> {
  const userResponse = page.waitForResponse(response => apiPath(response) === '/api/auth/me');
  await page.goto(path);
  const user = await requireFixtureUser(await userResponse, fixture);
  await expect(page.getByRole('button', { name: `Account menu for ${user.firstName} ${user.lastName}` })).toBeVisible();
}

async function reloadAsFixture(page: Page, fixture: Fixture): Promise<void> {
  const userResponse = page.waitForResponse(response => apiPath(response) === '/api/auth/me');
  await page.reload();
  const user = await requireFixtureUser(await userResponse, fixture);
  await expect(page.getByRole('button', { name: `Account menu for ${user.firstName} ${user.lastName}` })).toBeVisible();
}

async function signIn(page: Page, fixture: Fixture): Promise<void> {
  // Drain the document's first refresh attempt before submitting credentials. A stale 401
  // restore can otherwise arrive after login and clear the newly installed access token.
  const initialRefresh = page.waitForResponse(response => apiPath(response) === '/api/auth/refresh');
  await page.goto('/');
  const refreshResponse = await initialRefresh;
  if (refreshResponse.ok()) {
    const initialUserResponse = page.waitForResponse(response => apiPath(response) === '/api/auth/me');
    await initialUserResponse;
  }
  await page.getByRole('button', { name: 'Account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('you@example.com').fill(fixture.email);
  await dialog.getByPlaceholder('Enter your password').fill(fixture.password);
  // Login itself returns the authenticated user; it does not issue a second /me request.
  const currentUser = page.waitForResponse(response => apiPath(response) === '/api/auth/login');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  const userResponse = await currentUser;
  const user = await requireFixtureUser(userResponse, fixture);
  await expect(page.getByRole('button', { name: `Account menu for ${user.firstName} ${user.lastName}` })).toBeVisible();
}

// The app reports its own outcome: ready (skeleton removed), a provider load error, or its 90 s stall alert. The harness waits for
// that signal instead of a fixed ~30 s poll that also counted the slow DEV payment setup before the frame was even mounted.
const APP_ENTRY_DEADLINE_MS = 90_000 + 15_000;
async function stripeCardFrame(page: Page): Promise<Frame> {
  const loading = page.getByRole('status', { name: 'Loading secure payment form' });
  const failure = page.getByRole('alert').filter({ hasText: /Secure card entry|payment setup/i });
  await expect(page.locator('iframe[src*="js.stripe.com"]').first()).toBeAttached({ timeout: 60_000 });
  await expect(loading).toHaveCount(0, { timeout: APP_ENTRY_DEADLINE_MS });
  if (await failure.count()) throw new Error(`Hosted Stripe card entry failed in the app: ${await failure.first().innerText()}`);
  const marks = await page.evaluate(() => performance.getEntriesByType('mark').map(mark => mark.name).filter(name => name.startsWith('electrohub.payment.')));
  if (!marks.includes('electrohub.payment.payment-element-ready')) throw new Error(`Payment Element never reported ready: ${marks.join(',')}`);
  for (const frame of page.frames()) {
    if (frame.url().includes('js.stripe.com') && await frame.getByLabel('Card number', { exact: true }).count().catch(() => 0)) return frame;
  }
  throw new Error('Payment Element reported ready but no hosted card-number field was found.');
}

async function fillTestCard(page: Page): Promise<void> {
  const frame = await stripeCardFrame(page);
  await frame.getByLabel('Card number', { exact: true }).fill(CARD_OK);
  await frame.getByLabel(/Expiration/).fill('1230');
  await frame.getByLabel('Security code', { exact: true }).fill('123');
  const postal = frame.getByLabel(/ZIP|Postal/);
  if (await postal.count()) await postal.fill('12345');
}

async function checkout(page: Page, fixture: Fixture): Promise<void> {
  await gotoAsFixture(page, '/cart', fixture);
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.locator('#shipping-recipient')).toBeVisible();
  for (const [field, value] of Object.entries({
    recipient: 'Task04 Synthetic Shopper', line1: '1 Test Avenue', city: 'Test City', postalCode: '12345', phone: '+1 555 010 2040',
  })) await page.locator(`#shipping-${field}`).fill(value);
  const country = page.locator('#shipping-country');
  if (await country.evaluate(node => node.tagName === 'SELECT')) await country.selectOption({ label: 'United States' });
  else await country.fill('United States');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('radio', { name: /Standard Delivery/ }).check();

  const capabilityResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/checkout/payment-capability');
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  const capability = await capabilityResponse;
  if (!capability.ok() || (await capability.json())?.data?.paymentsEnabled !== true) {
    throw new Error('MAIN_DEV did not report payment capability as enabled.');
  }
  await fillTestCard(page);
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
}

/** Post-purchase acceptance (My Orders, Order Details, three private PDFs, reload/reauth at 390px). Never touches checkout. */
async function verifyPurchasedOrder(page: Page, fixture: Fixture, orderReference: string, productTitle: string, api: ReturnType<typeof monitorApi>) {
  await gotoAsFixture(page, '/orders', fixture);
  const orderLink = page.getByRole('link', { name: new RegExp(orderReference) }).first();
  await expect(orderLink).toBeVisible({ timeout: 30_000 });
  // History cards show the purchased product as an image whose accessible name is its title.
  await expect(page.getByRole('img', { name: productTitle }).first()).toBeVisible();
  await orderLink.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderReference}$`));
  const documentPanel = page.getByRole('region', { name: 'Documents' });
  await expect(documentPanel.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });

  await mkdir(outputDirectory, { recursive: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(outputDirectory, 'order-details-1440.png'), fullPage: true });

  for (const [label, suffix] of [
    ['Order invoice (non-tax)', 'invoice'], ['Payment receipt', 'receipt'], ['Order summary', 'summary'],
  ] as const) {
    const downloadPromise = page.waitForEvent('download');
    await documentPanel.getByRole('button', { name: `Download PDF: ${label}, order ${orderReference}` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`ElectroHub-${orderReference}-${suffix}.pdf`);
    const filePath = await download.path();
    if (!filePath) throw new Error('PDF download did not produce a local file.');
    const bytes = await readFile(filePath);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10_000);
  }
  expect(api.documentMethods).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await reloadAsFixture(page, fixture);
  await expect(documentPanel.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(outputDirectory, 'order-details-390.png'), fullPage: true });
}

test('MAIN_DEV synthetic customer completes one real Test Mode order and reads its PDFs', async ({ page }) => {
  test.skip(process.env.TASK04_VERIFY_ONLY === '1', 'Verification-only run: no checkout.');
  if (process.env.TASK04_DEV_PURCHASE_APPROVED !== '1') {
    throw new Error('Task04 DEV purchase is gated. Use playwright.task04.config.ts with explicit approval.');
  }
  test.setTimeout(360_000);
  await verifyMainDevRuntime();
  const fixture = await loadFixture();
  let state: { stage?: unknown; resumeAuthorization?: { id?: unknown; consumedAt?: unknown } };
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch { throw new Error('Private Task04 progress marker is unavailable or malformed.'); }
  const resumeId = process.env.TASK04_RESUME_AUTHORIZATION;
  const resuming = state.stage === 'journeyStarted' && typeof resumeId === 'string' && state.resumeAuthorization?.id === resumeId &&
    typeof state.resumeAuthorization.consumedAt === 'string';
  if (state.stage !== 'prepared' && !resuming) throw new Error('Task04 fixture already has a purchase attempt. Do not click Place Order again.');

  const api = monitorApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, fixture);
  console.info('Task04: synthetic session verified');

  const cartResponse = page.waitForResponse(response => apiPath(response) === '/api/cart' && response.request().method() === 'GET');
  await gotoAsFixture(page, '/cart', fixture);
  const cartLines = ((await (await cartResponse).json())?.data?.items ?? []) as { productId?: string; quantity?: number }[];
  if (!resuming) await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  else if (cartLines.length > 1 || cartLines.some(line => line.productId !== fixture.productId || line.quantity !== 1)) {
    throw new Error('Resume refused: the fixture cart no longer matches the reconciled pre-submit state.');
  }
  const productResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/products/${encodeURIComponent(fixture.productSlug)}`);
  await gotoAsFixture(page, `/products/${encodeURIComponent(fixture.productSlug)}`, fixture);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const product = await productResponse;
  if (!product.ok() || (await product.json())?.data?.id !== fixture.productId) throw new Error('The browser product does not match the private synthetic fixture.');
  const productTitle = await page.getByRole('heading', { level: 1 }).innerText();
  await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeEnabled();
  // A resume keeps the original journeyStarted record; identical cart, shipping and delivery replay the reconciled attempt server-side.
  if (resuming) await writeProgress({ resumedAt: new Date().toISOString() });
  else await writeProgress({ stage: 'journeyStarted', startedAt: new Date().toISOString() });
  if (!cartLines.length) {
    const added = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cart/items' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    expect((await added).status()).toBe(201);
  }
  console.info('Task04: persisted cart item verified');
  await checkout(page, fixture);
  console.info('Task04: hosted Test Mode card entered; review ready');

  // Commit a one-way local guard before the only Place Order click. Any later failure requires operator reconciliation.
  await writeProgress({ stage: 'confirmSubmitted', startedAt: new Date().toISOString() });
  const submissionRequest = page.waitForRequest(request => /^\/api\/checkout\/payment-attempts\/[0-9a-f-]{36}\/submit$/i.test(new URL(request.url()).pathname));
  await page.getByRole('button', { name: /Place Order/ }).click();
  await submissionRequest;
  const submission = api.submission();
  if (submission.count !== 1 || !submission.attemptId) throw new Error('Expected exactly one payment submit request. Do not retry this fixture.');
  await writeProgress({ stage: 'confirmSubmitted', startedAt: new Date().toISOString(), paymentAttemptId: submission.attemptId });

  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible({ timeout: 120_000 });
  const detailsLink = page.getByRole('link', { name: 'View Order Details' });
  await expect(detailsLink).toBeVisible();
  const href = await detailsLink.getAttribute('href');
  const orderReference = href?.match(/^\/orders\/([^/?#]+)$/)?.[1];
  if (!orderReference) throw new Error('Confirmed order did not provide a valid Order Details link.');
  await writeProgress({ stage: 'purchased', purchasedAt: new Date().toISOString(), paymentAttemptId: submission.attemptId, orderReference });

  await verifyPurchasedOrder(page, fixture, orderReference, productTitle, api);
  expect(api.submission().count).toBe(1);
  await savePerformance(api.measurements);
});

test('MAIN_DEV purchased fixture: My Orders, Order Details and PDFs after reauthentication (verification only)', async ({ page }) => {
  test.skip(process.env.TASK04_VERIFY_ONLY !== '1', 'Runs only with TASK04_VERIFY_ONLY=1 after a recorded purchase.');
  test.setTimeout(240_000);
  await verifyMainDevRuntime();
  const fixture = await loadFixture();
  const state = JSON.parse(await readFile(statePath, 'utf8')) as { stage?: unknown; orderReference?: unknown };
  if (state.stage !== 'purchased' || typeof state.orderReference !== 'string' || !/^ORD-[0-9A-F-]{36}$/.test(state.orderReference)) {
    throw new Error('Verification-only mode requires a recorded purchased fixture.');
  }
  const api = monitorApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, fixture);
  const productResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/products/${encodeURIComponent(fixture.productSlug)}`);
  await gotoAsFixture(page, `/products/${encodeURIComponent(fixture.productSlug)}`, fixture);
  if ((await (await productResponse).json())?.data?.id !== fixture.productId) throw new Error('The browser product does not match the private synthetic fixture.');
  const productTitle = await page.getByRole('heading', { level: 1 }).innerText();
  await verifyPurchasedOrder(page, fixture, state.orderReference, productTitle, api);
  expect(api.submission().count).toBe(0);
  await savePerformance(api.measurements);
});
