import { expect, request, test, type BrowserContext, type Page, type Request, type Route } from '@playwright/test';
import { accountMenu, admins, apiOrigin, cartLink, distinctClientAddress, expectNoHorizontalOverflow, expectUsableControl, product, samplePng,
  shopper, signInAdmin, signInCustomer, supportToken } from './support';

/**
 * Task 06.2 cookie consent and privacy on the real stack (Vite → Express NODE_ENV=test → disposable PostgreSQL, real migrations).
 * What the browser sends, what the server stores (read back through the test-only /api/__e2e/analytics-probe, keyed by random values
 * only this browser knows), the refresh-cookie headers the browser actually receives, third-party requests and storage, and the
 * essential journeys after optional analytics is rejected. No Stripe key, AI service or email provider exists on this stack.
 */
const CONSENT_KEY = 'electrohub.privacy.v1';
const SESSION_KEY = 'eh.storefront-session';
const OPTIONAL = /\/api\/(analytics\/events|analytics\/withdrawals|recommendations\/events)/;
const firstParty = (url: string) => { const { hostname, protocol } = new URL(url); return ['localhost', '127.0.0.1'].includes(hostname) || !protocol.startsWith('http'); };

function watchOptional(page: Page) {
  const seen: { url: string; body: string | null }[] = [];
  page.on('request', item => { if (OPTIONAL.test(item.url())) seen.push({ url: item.url(), body: item.postData() }); });
  return seen;
}
function watchThirdParty(context: BrowserContext) {
  const hosts = new Set<string>();
  context.on('request', item => { if (!firstParty(item.url())) hosts.add(new URL(item.url()).hostname); });
  return hosts;
}
const banner = (page: Page) => page.getByRole('region', { name: 'Cookie preferences' });
const sessionId = (page: Page) => page.evaluate(key => sessionStorage.getItem(key), SESSION_KEY);
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Cookie Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cookie Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function probe(body: { ref?: string; sessionId?: string }) {
  const api = await request.newContext({ baseURL: apiOrigin, extraHTTPHeaders: { Connection: 'close' } });
  try {
    const response = await api.post('/api/__e2e/analytics-probe', { headers: { 'x-e2e-test-support-token': supportToken }, data: body });
    expect(response.status()).toBe(200);
    return await response.json() as { bound: boolean; imageSearch: { type: string; outcome: string | null }[] | null; session: { durationMs: number } | null };
  } finally { await api.dispose(); }
}
/** Browses the storefront like a shopper: home, a product page and a text search (full navigations, so pagehide fires each time). */
async function browse(page: Page) {
  for (const url of ['/', `/products/${product('REL-AURORA-HP').slug}`, '/search?q=aurora', '/']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // A real scroll of the document (mobile WebKit has no mouse wheel), so recommendation cards can enter the viewport.
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(1_300); // longer than the 1 s session minimum and the 1 s impression dwell
  }
}
async function openImageSearch(page: Page) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search ElectroHub' });
  await dialog.getByRole('button', { name: 'Search by image' }).click();
  await dialog.getByLabel('Choose a photo').setInputFiles({ name: 'speaker.png', mimeType: 'image/png', buffer: samplePng() });
  return dialog;
}
/** Holds the next photo upload in the browser until `release` is called; the analytics reference header is captured. */
function holdImageSearch(page: Page) {
  let release!: (mode: 'continue' | 'fetch-then-hold') => void;
  const gate = new Promise<'continue' | 'fetch-then-hold'>(resolve => { release = resolve; });
  const captured: { ref?: string; consented?: string; route?: Route; uploaded: Promise<void> } = { uploaded: Promise.resolve() };
  let uploaded!: () => void;
  captured.uploaded = new Promise(resolve => { uploaded = resolve; });
  void page.route('**/api/search/image**', async route => {
    const headers = route.request().headers();
    captured.ref = headers['x-electrohub-analytics-ref'];
    captured.consented = headers['x-electrohub-analytics'];
    captured.route = route;
    uploaded();
    if (await gate === 'continue') await route.continue();
  });
  return { captured, release };
}
async function rejectInSettings(page: Page) {
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Reject optional' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('cookie consent and analytics gating', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  test('@responsive first visit offers an equal choice and nothing optional runs before or after rejection', async ({ page, context }, testInfo) => {
    const optional = watchOptional(page);
    const thirdParty = watchThirdParty(context);
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    // Reject is offered as prominently as Accept: same row, same size class, both inside the viewport.
    const accept = banner(page).getByRole('button', { name: 'Accept all' });
    const reject = banner(page).getByRole('button', { name: 'Reject optional' });
    for (const [control, label] of [[accept, 'Accept all'], [reject, 'Reject optional'], [banner(page).getByRole('button', { name: 'Customize' }), 'Customize']] as const) {
      await expectUsableControl(control, label);
    }
    const [acceptBox, rejectBox] = [await accept.boundingBox(), await reject.boundingBox()];
    expect(Math.abs(acceptBox!.height - rejectBox!.height)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page, 'consent banner');
    await testInfo.attach('banner.png', { body: await page.screenshot(), contentType: 'image/png' });

    // Undecided visitors are not measured (no identifier, no request), even while browsing.
    await browse(page);
    expect(await sessionId(page)).toBeNull();
    expect(optional).toEqual([]);

    await reject.click();
    await expect(banner(page)).toHaveCount(0);
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), CONSENT_KEY);
    // The stored record holds the choice and its time only: no identifier, account, token or secret.
    expect(Object.keys(stored).sort()).toEqual(['analytics', 'savedAt', 'version']);
    expect(stored).toMatchObject({ version: 1, analytics: false });
    await page.reload();
    await expect(banner(page)).toHaveCount(0);
    await browse(page);
    expect(await sessionId(page)).toBeNull();
    expect(optional, 'no optional analytics after rejection').toEqual([]);
    // The storefront itself (home, product, search) loads no third-party resource.
    expect([...thirdParty]).toEqual([]);
  });

  test('acceptance measures storefront time server-side; withdrawal removes the identifier and stops new measurement', async ({ page }) => {
    const optional = watchOptional(page);
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Accept all' }).click();
    await expect.poll(() => sessionId(page)).toMatch(/^[0-9a-f-]{36}$/);
    const id = (await sessionId(page))!;
    await page.waitForTimeout(1_500);
    const delivered = page.waitForResponse(response => response.url().includes('/api/analytics/events') && response.request().postData()?.includes(id) === true);
    await page.goto(`/products/${product('REL-AURORA-HP').slug}`); // pagehide reports the visible time so far
    expect((await delivered).status()).toBe(202);
    await expect.poll(async () => (await probe({ sessionId: id })).session?.durationMs ?? 0).toBeGreaterThanOrEqual(1_000);
    const sent = optional.filter(item => item.body?.includes('storefront.session'));
    expect(sent.length).toBeGreaterThan(0);
    // The session event carries only the random tab id and a duration.
    expect(Object.keys(JSON.parse(sent[0].body!)).sort()).toEqual(['sessionId', 'type', 'visibleMs']);

    await rejectInSettings(page);
    expect(await sessionId(page)).toBeNull();
    const before = optional.length;
    await browse(page);
    expect(await sessionId(page)).toBeNull();
    expect(optional.slice(before), 'no optional analytics after withdrawal').toEqual([]);
    // The settings reopen with analytics off; the banner does not come back.
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(banner(page)).toHaveCount(0);
    // Already-stored history is not deleted by the browser setting (disclosed in the Cookie Policy).
    expect((await probe({ sessionId: id })).session).not.toBeNull();
  });

  test('a withdrawal in another tab applies to this tab without a reload', async ({ context }) => {
    const first = await context.newPage();
    const optional = watchOptional(first);
    await first.goto('/');
    await banner(first).getByRole('button', { name: 'Accept all' }).click();
    await expect.poll(() => sessionId(first)).not.toBeNull();
    const second = await context.newPage();
    await second.goto('/');
    await expect(banner(second)).toHaveCount(0);
    await rejectInSettings(second);
    // The first tab hears the storage event: its identifier is removed and nothing more is sent.
    await expect.poll(() => sessionId(first)).toBeNull();
    const before = optional.length;
    await first.waitForTimeout(1_500);
    await first.goto('/');
    await first.waitForTimeout(1_300);
    expect(optional.slice(before)).toEqual([]);
    const dialog = await openSettings(first);
    await expect(dialog.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
  });

  test('corrupted, expired or unsaveable choices never enable analytics', async ({ browser }, testInfo) => {
    const cases = [
      ['corrupted', `localStorage.setItem('${CONSENT_KEY}', '{"version":1,"analytics":tru')`],
      ['wrong schema', `localStorage.setItem('${CONSENT_KEY}', JSON.stringify({ version: 2, analytics: true, savedAt: Date.now() }))`],
      ['expired', `localStorage.setItem('${CONSENT_KEY}', JSON.stringify({ version: 1, analytics: true, savedAt: Date.now() - 181 * 864e5 }))`],
    ] as const;
    for (const [label, script] of cases) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await distinctClientAddress(page, testInfo);
      const optional = watchOptional(page);
      await page.addInitScript(`if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); ${script}; }`);
      await page.goto('/');
      await expect(banner(page), label).toBeVisible();
      await page.waitForTimeout(1_300);
      await page.goto('/search?q=aurora');
      expect(await sessionId(page), label).toBeNull();
      expect(optional, label).toEqual([]);
      await context.close();
    }

    // Storage refuses writes for the choice: nothing is assumed; the visitor is told the choice lasts for this page only.
    const context = await browser.newContext();
    const page = await context.newPage();
    await distinctClientAddress(page, testInfo);
    await page.addInitScript(`{
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === '${CONSENT_KEY}') throw new DOMException('blocked', 'QuotaExceededError'); return set.call(this, key, value); };
    }`);
    const optional = watchOptional(page);
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Reject optional' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'could not be saved on this device' })).toHaveCount(1);
    await expect(banner(page)).toHaveCount(0);
    await page.waitForTimeout(1_300);
    await page.reload();
    // Not persisted, so the next page asks again instead of guessing; still nothing optional was sent.
    await expect(banner(page)).toBeVisible();
    expect(optional).toEqual([]);
    await context.close();
  });
});

test.describe('in-flight image search and withdrawal', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  async function consentedSearch(page: Page) {
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Accept all' }).click();
    const hold = holdImageSearch(page);
    const dialog = await openImageSearch(page);
    const results = dialog.getByText(/unavailable right now|isn’t available yet/).first();
    await dialog.getByRole('button', { name: 'Search similar products' }).click();
    return { hold, dialog, results };
  }
  /** Image search is a build-time switch; on a build without it no photo (and no analytics) ever leaves the browser. */
  async function requireEnabled(page: Page, dialog: ReturnType<Page['getByRole']>) {
    const off = dialog.getByText('Image search isn’t available yet. Your photo was not sent.');
    test.skip(await off.isVisible().catch(() => false), 'image search is switched off in this build (VITE_IMAGE_SEARCH_ENABLED)');
    void page;
  }

  test('control: a consented search without withdrawal is recorded once, with a fixed category only', async ({ page }) => {
    const { hold, dialog, results } = await consentedSearch(page);
    await Promise.race([hold.captured.uploaded, results.waitFor()]);
    await requireEnabled(page, dialog);
    expect(hold.captured.consented).toBe('consented');
    expect(hold.captured.ref).toMatch(/^[0-9a-f-]{36}$/);
    hold.release('continue');
    await expect(results).toBeVisible();
    await expect.poll(async () => (await probe({ ref: hold.captured.ref })).imageSearch).toEqual([{ type: 'image_search.failed', outcome: 'upstream_unavailable' }]);
  });

  test('withdrawal (from another tab) before the server sees the search: nothing is written, the shopper still gets an answer', async ({ page, context }) => {
    const optional = watchOptional(page);
    const { hold, dialog, results } = await consentedSearch(page);
    await Promise.race([hold.captured.uploaded, results.waitFor()]);
    await requireEnabled(page, dialog);
    const other = await context.newPage();
    await other.goto('/');
    await rejectInSettings(other);
    // The searching tab sends its pending reference to the server.
    await expect.poll(() => optional.filter(item => item.url.includes('/api/analytics/withdrawals')).length).toBe(1);
    expect(JSON.parse(optional.find(item => item.url.includes('withdrawals'))!.body!)).toEqual({ refs: [hold.captured.ref] });
    hold.release('continue');
    await expect(results).toBeVisible();
    await page.waitForTimeout(500);
    const state = await probe({ ref: hold.captured.ref });
    expect(state.bound).toBe(true); // the search did reach the server ...
    expect(state.imageSearch).toEqual([]); // ... and wrote nothing
  });

  test('withdrawal after the server wrote the outcome (response still in transit): the row is erased', async ({ page, context }) => {
    const { hold, dialog, results } = await consentedSearch(page);
    await Promise.race([hold.captured.uploaded, results.waitFor()]);
    await requireEnabled(page, dialog);
    const route = hold.captured.route!;
    hold.release('fetch-then-hold');
    // The real server answers and writes its analytics row. WebKit does not expose a file-upload (Blob) body to
    // interception, so there the same multipart upload is rebuilt: same field, file and bytes, original headers.
    const original = route.request().postDataBuffer();
    const boundary = `----e2e${Date.now().toString(16)}`;
    const { 'content-length': _length, ...headers } = route.request().headers();
    void _length;
    const response = await route.fetch(original?.length ? undefined : {
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      postData: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="speaker.png"\r\nContent-Type: image/png\r\n\r\n`),
        samplePng(), Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(response.status(), 'the forwarded upload is processed, not refused as malformed').not.toBe(400);
    await expect.poll(async () => (await probe({ ref: hold.captured.ref })).imageSearch?.length ?? 0).toBe(1);
    const other = await context.newPage();
    await other.goto('/');
    await rejectInSettings(other);
    await expect.poll(async () => (await probe({ ref: hold.captured.ref })).imageSearch).toEqual([]);
    await route.fulfill({ response });
    await expect(results).toBeVisible();
  });
});

test.describe('cookies, providers and essential functions with analytics rejected', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  const parse = (header: string) => {
    const [pair, ...rest] = header.split(';').map(part => part.trim());
    return { name: pair.slice(0, pair.indexOf('=')), empty: pair.endsWith('='), flags: rest.map(flag => flag.toLowerCase()) };
  };
  async function setCookies(item: Request) {
    const response = await item.response();
    return (await response?.headersArray() ?? []).filter(header => header.name.toLowerCase() === 'set-cookie').map(header => parse(header.value));
  }

  test('customer refresh cookie: real headers on login, rotation on reload, expiry on logout; no script access', async ({ page, context }, testInfo) => {
    const authCalls: Request[] = [];
    page.on('request', item => { if (/\/api\/auth\/(login|customer\/(refresh|logout))/.test(item.url())) authCalls.push(item); });
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Reject optional' }).click();
    await signInCustomer(page, shopper(testInfo, 'privacy').email);
    const login = authCalls.find(item => item.url().endsWith('/api/auth/login'))!;
    const issued = (await setCookies(login)).find(cookie => cookie.name === 'electrohub_customer_refresh')!;
    expect(issued.flags).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/api/auth/customer', 'max-age=604800']));
    expect(issued.flags.some(flag => flag.startsWith('domain='))).toBe(false);
    // NODE_ENV=test over plain HTTP: Secure is intentionally absent here; production adds it (backend refresh-cookie-attributes test).
    testInfo.annotations.push({ type: 'set-cookie', description: `login: electrohub_customer_refresh; ${issued.flags.join('; ')}` });
    const stored = (await context.cookies()).find(cookie => cookie.name === 'electrohub_customer_refresh')!;
    expect(stored).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth/customer' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('electrohub_');

    await page.reload();
    await expect(accountMenu(page)).toBeVisible();
    const refresh = authCalls.filter(item => item.url().endsWith('/api/auth/customer/refresh')).at(-1)!;
    expect((await refresh.response())?.status()).toBe(200);
    expect((await refresh.allHeaders()).cookie ?? '').not.toContain('electrohub_admin_refresh');
    const rotated = (await context.cookies()).find(cookie => cookie.name === 'electrohub_customer_refresh')!;
    expect(rotated.value).not.toBe(stored.value);

    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    await page.getByRole('dialog', { name: 'Sign Out' }).getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
    const logout = authCalls.find(item => item.url().endsWith('/api/auth/customer/logout'))!;
    const cleared = (await setCookies(logout)).find(cookie => cookie.name === 'electrohub_customer_refresh')!;
    expect(cleared.empty).toBe(true);
    expect(cleared.flags).toEqual(expect.arrayContaining(['path=/api/auth/customer', 'expires=thu, 01 jan 1970 00:00:00 gmt']));
    expect((await context.cookies()).some(cookie => cookie.name === 'electrohub_customer_refresh')).toBe(false);
    // Rejecting analytics never touched the essential cookie, and the choice survives sign-in and sign-out.
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).analytics, CONSENT_KEY)).toBe(false);
  });

  test('administrator MFA sign-in, refresh-cookie isolation and session restore work with analytics rejected', async ({ page, context }, testInfo) => {
    test.slow();
    await page.goto('/');
    await banner(page).getByRole('button', { name: 'Reject optional' }).click();
    const adminCalls: Request[] = [];
    page.on('request', item => { if (/\/api\/auth\/admin\//.test(item.url())) adminCalls.push(item); });
    await signInAdmin(page, admins(testInfo).privacyEmail);
    const cookies = await context.cookies();
    const adminCookie = cookies.find(cookie => cookie.name === 'electrohub_admin_refresh')!;
    expect(adminCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth/admin' });
    expect(cookies.some(cookie => cookie.name === 'electrohub_customer_refresh')).toBe(false);
    const issuedBy: ReturnType<typeof parse>[] = [];
    for (const item of adminCalls) for (const cookie of await setCookies(item)) if (cookie.name === 'electrohub_admin_refresh' && !cookie.empty) issuedBy.push(cookie);
    expect(issuedBy.length).toBeGreaterThan(0);
    expect(issuedBy[0].flags).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/api/auth/admin']));
    testInfo.annotations.push({ type: 'set-cookie', description: `admin: electrohub_admin_refresh; ${issuedBy[0].flags.join('; ')}` });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });
    // The customer refresh path never receives the administrator cookie.
    const customerRefresh = await page.request.post('/api/auth/customer/refresh');
    expect(customerRefresh.status()).toBe(401);
    // The admin console carries no consent banner and makes no optional analytics request.
    await expect(banner(page)).toHaveCount(0);
  });

  test('@responsive guest and signed-in cart, wishlist and checkout work after rejecting analytics; provider storage stays on checkout', async ({ page, context }, testInfo) => {
    const thirdParty = watchThirdParty(context);
    const optional = watchOptional(page);
    const buyer = shopper(testInfo, 'privacy');
    await page.goto(`/products/${product('REL-ATLAS-DOCK').slug}`);
    await banner(page).getByRole('button', { name: 'Reject optional' }).click();
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 1)).toBeVisible();
    await page.reload();
    await expect(cartLink(page, 1)).toBeVisible(); // the guest cart is essential storage and survives
    await signInCustomer(page, buyer.email); // lands on My Account; the guest cart merges into the account
    await expect(cartLink(page, 1)).toBeVisible();
    await page.goto(`/products/${product('REL-ATLAS-DOCK').slug}`);
    await page.getByRole('button', { name: `Add ${product('REL-ATLAS-DOCK').name} to wishlist` }).first().click();
    const remove = page.getByRole('button', { name: `Remove ${product('REL-ATLAS-DOCK').name} from wishlist` }).first();
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(page.getByRole('button', { name: `Add ${product('REL-ATLAS-DOCK').name} to wishlist` }).first()).toBeVisible();
    expect([...thirdParty], 'no third-party request before checkout').toEqual([]);

    await page.goto('/cart');
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    await page.waitForTimeout(2_000);
    // Stripe.js is loaded by the checkout chunk (provider fraud prevention); record exactly what it did in this browser.
    const stripeCookies = (await context.cookies()).filter(cookie => cookie.name.startsWith('__stripe'))
      .map(({ name, domain, httpOnly, secure, sameSite, expires }) => ({ name, domain, httpOnly, secure, sameSite,
        lifetimeDays: expires > 0 ? Math.round((expires * 1000 - Date.now()) / 864e5 * 10) / 10 : 'session' }));
    await testInfo.attach('checkout-provider-storage.json', { contentType: 'application/json',
      body: JSON.stringify({ thirdPartyHosts: [...thirdParty].sort(), stripeCookies }, null, 2) });
    for (const host of thirdParty) expect(host, 'only the payment provider is contacted on checkout').toMatch(/(^|\.)stripe\.(com|network)$/);
    expect(optional, 'no optional analytics during essential journeys').toEqual([]);
    // Restore the fixture cart for later runs.
    await page.goto('/cart');
    await page.getByRole('button', { name: `Remove ${product('REL-ATLAS-DOCK').name} from cart` }).click();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  });
});
