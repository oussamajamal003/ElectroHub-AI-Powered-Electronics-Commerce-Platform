import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page, type Response, type TestInfo } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const isolatedQaDirectory = realpathSync(path.resolve(here, '../../../backend/.isolated-docker'));
const expectedFixturePath = path.join(isolatedQaDirectory, 'task044-browser-fixtures.json');
const fixturePath = path.resolve(process.env.TASK044_QA_USERS_FILE ?? expectedFixturePath);
if (path.dirname(fixturePath) !== isolatedQaDirectory || path.basename(fixturePath) !== 'task044-browser-fixtures.json') {
  throw new Error('Refusing the live browser gate: QA credentials must be in the backend isolated-QA directory.');
}
const realFixturePath = realpathSync(fixturePath);
if (path.dirname(realFixturePath) !== isolatedQaDirectory || path.basename(realFixturePath) !== 'task044-browser-fixtures.json') {
  throw new Error('Refusing the live browser gate: QA credential path resolves outside the isolated-QA directory.');
}
const isolatedBaseUrl = new URL(process.env.ISOLATED_BASE_URL ?? 'http://127.0.0.1:3200');
if (isolatedBaseUrl.protocol !== 'http:' || isolatedBaseUrl.hostname !== '127.0.0.1' || isolatedBaseUrl.port !== '3200' ||
  isolatedBaseUrl.pathname !== '/' || isolatedBaseUrl.search || isolatedBaseUrl.hash || isolatedBaseUrl.username || isolatedBaseUrl.password) {
  throw new Error('Refusing the live browser gate: frontend URL must be the loopback isolated app at 127.0.0.1:3200.');
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  runId: string;
  created: { id: string; email: string; password: string }[];
};
if (fixture.created.length !== 2 || fixture.created.some(user => !user.email.startsWith(`task044-${fixture.runId}-`))) {
  throw new Error('Refusing the live browser gate: expected exactly two task-owned QA customers.');
}
const customerA = fixture.created[0]!;
const customerB = fixture.created[1]!;
const productX = { slug: 'tp-link-archer-ax55', id: '43e75f45-c5fa-517c-b937-e49668da53dc', name: 'TP-Link Archer AX55' };
const productY = { slug: 'tp-link-archer-ax23', id: '41e2cbae-5189-543e-a378-bff0f404c747', name: 'TP-Link Archer AX23' };
const apiPath = (response: Response) => new URL(response.url()).pathname;

async function login(page: Page, user: { email: string; password: string }): Promise<string> {
  const loginResponse = page.waitForResponse(response => apiPath(response) === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('button', { name: /Account menu for QA Customer/ })).toBeVisible();
  const body = await (await loginResponse).json() as { accessToken?: unknown };
  expect(typeof body.accessToken === 'string').toBe(true);
  return `Bearer ${body.accessToken as string}`;
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /Account menu for QA Customer/ }).click();
  await page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
}

async function readAuthenticatedJson(page: Page, endpoint: string, authorization: string) {
  return page.evaluate(async ({ path, bearer }) => {
    const response = await fetch(path, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: { Authorization: bearer, Accept: 'application/json' },
    });
    return { status: response.status, body: await response.json() as unknown };
  }, { path: endpoint, bearer: authorization });
}

async function ensureConsentOff(page: Page, currentValue: boolean, authorization: string) {
  if (currentValue) {
    await page.getByRole('switch', { name: 'Personalized recommendations' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Personalized recommendations are off and your activity history was deleted.' })).toBeVisible();
  }
  const preferences = await readAuthenticatedJson(page, '/api/me/recommendation-preferences', authorization);
  expect(preferences.status).toBe(200);
  expect((preferences.body as { data: { personalizationEnabled: boolean } }).data.personalizationEnabled).toBe(false);
  const recent = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', authorization);
  expect(recent.status).toBe(200);
  expect((recent.body as { data: { items: { id: string }[] } }).data.items).toEqual([]);
  await expect(page.getByRole('switch', { name: 'Personalized recommendations' })).toHaveAttribute('aria-checked', 'false');
}

async function interactionRequest(page: Page, productId: string) {
  return page.waitForRequest(request => new URL(request.url()).pathname === '/api/product-interactions' && request.method() === 'POST' &&
    (request.postDataJSON() as { productId: string }).productId === productId);
}

async function publicRecommendationResponse(page: Page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/products/${productX.slug}/recommendations` &&
    response.request().method() === 'GET');
}

async function loadProductImages(page: Page) {
  const images = page.locator('main img');
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) await images.nth(index).scrollIntoViewIfNeeded();
  await expect.poll(() => images.evaluateAll(elements => elements.every(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  })), { timeout: 20_000 }).toBe(true);
}

async function visibleFirstRecommendation(page: Page, token: string, testInfo: TestInfo, filename: string) {
  const similar = page.getByRole('list', { name: 'Similar Products' });
  await expect(similar.getByRole('listitem').first()).toBeVisible();
  const eventResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/recommendations/events' &&
    response.request().method() === 'POST');
  await similar.evaluate(element => element.getBoundingClientRect().height && element.scrollIntoView({ block: 'center' }));
  await expect.poll(async () => await similar.getByRole('listitem').first().evaluate(element => {
    const rect = element.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    return visibleHeight * visibleWidth / (rect.width * rect.height);
  })).toBeGreaterThanOrEqual(0.5);
  const response = await eventResponse;
  expect(response.status()).toBe(202);
  const body = response.request().postDataJSON() as { token: string; events: { productId: string; type: string }[] };
  expect(body.token === token).toBe(true);
  expect(body.events.some(event => event.type === 'IMPRESSION')).toBe(true);
  await loadProductImages(page);
  await page.screenshot({ path: testInfo.outputPath(filename), fullPage: true, animations: 'disabled' });
  return body;
}

async function newIsolatedContext(browser: Browser, viewport: { width: number; height: number }) {
  return browser.newContext({ viewport, reducedMotion: 'reduce', baseURL: isolatedBaseUrl.toString() });
}

async function tabUntilFocused(page: Page, target: ReturnType<Page['getByRole']>, maxPresses = 300) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const handle = await target.elementHandle();
  if (!handle) return false;
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(element => element === document.activeElement, handle)) return true;
  }
  return false;
}

test('preference switch is available when off and disabled only while opted-in history loads', async ({ browser }, testInfo) => {
  const context = await newIsolatedContext(browser, { width: 1440, height: 900 });
  const page = await context.newPage();
  let releaseHistory: (() => void) | undefined;
  let signedIn = false;
  try {
    await page.goto('/');
    const bearer = await login(page, customerA);
    signedIn = true;
    await page.goto('/account');
    const toggle = page.getByRole('switch', { name: 'Personalized recommendations' });
    await expect(toggle).toBeVisible();
    await ensureConsentOff(page, await toggle.getAttribute('aria-checked') === 'true', bearer);
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByRole('status').filter({ hasText: 'Personalized recommendations are on.' })).toBeVisible();
    let enteredHistory!: () => void;
    const historyEntered = new Promise<void>(resolve => { enteredHistory = resolve; });
    await page.route('**/api/me/recently-viewed?*', async route => {
      enteredHistory();
      await new Promise<void>(resolve => { releaseHistory = resolve; });
      await route.continue().catch(() => undefined);
    });
    await page.reload();
    await historyEntered;
    await expect(toggle).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('switch-initial-history-loading.png'), fullPage: true, animations: 'disabled' });
    releaseHistory?.();
    releaseHistory = undefined;
    await expect(toggle).toBeEnabled();
  } finally {
    releaseHistory?.();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    if (signedIn) await logout(page).catch(() => undefined);
    await context.close();
  }
});

test('one browser account switch isolates A history and records B’s same-bucket view independently', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const context = await newIsolatedContext(browser, { width: 1440, height: 900 });
  const page = await context.newPage();
  let currentOwner: 'A' | 'B' | null = null;
  let releaseDelayedA: (() => void) | undefined;
  let delayedAAuthorization: string | undefined;
  let settleDelayedAResponse!: (result: { status: number; recorded: boolean; reason: string | null }) => void;
  const delayedAResponseSettled = new Promise<{ status: number; recorded: boolean; reason: string | null }>(resolve => {
    settleDelayedAResponse = resolve;
  });
  let aXRequestSeen!: () => void;
  const aXEntered = new Promise<void>(resolve => { aXRequestSeen = resolve; });
  let delayedAStarted = false;
  let abortDelayedAOnCleanup = false;
  await page.route('**/api/product-interactions', async route => {
    const payload = route.request().postDataJSON() as { productId: string };
    if (currentOwner === 'A' && payload.productId === productX.id && !delayedAStarted) {
      delayedAStarted = true;
      delayedAAuthorization = route.request().headers().authorization;
      aXRequestSeen();
      await new Promise<void>(resolve => { releaseDelayedA = resolve; });
      if (abortDelayedAOnCleanup) {
        await route.abort('aborted').catch(() => undefined);
        settleDelayedAResponse({ status: 0, recorded: false, reason: 'TEST_CLEANUP' });
        return;
      }
      try {
        const response = await route.fetch();
        const body = await response.json() as { data: { recorded: boolean; reason: string | null } };
        settleDelayedAResponse({ status: response.status(), recorded: body.data.recorded, reason: body.data.reason });
        await route.fulfill({ response });
      } catch {
        settleDelayedAResponse({ status: 0, recorded: false, reason: 'REQUEST_ABORTED' });
        await route.abort('aborted').catch(() => undefined);
      }
      return;
    }
    await route.continue();
  });
  try {
    await page.goto('/');
    currentOwner = 'A';
    const aBearer = await login(page, customerA);
    await page.goto('/account');
    const aPreferences = await readAuthenticatedJson(page, '/api/me/recommendation-preferences', aBearer);
    expect(aPreferences.status).toBe(200);
    const aPreferenceData = (aPreferences.body as { data: { personalizationEnabled: boolean } }).data;
    const aConsentOffAtGateStart = !aPreferenceData.personalizationEnabled;
    await ensureConsentOff(page, aPreferenceData.personalizationEnabled, aBearer);
    await page.getByRole('switch', { name: 'Personalized recommendations' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Personalized recommendations are on.' })).toBeVisible();

    const aYRequest = interactionRequest(page, productY.id);
    const aYResponsePromise = page.waitForResponse(response => apiPath(response) === '/api/product-interactions' && response.request().method() === 'POST');
    await page.goto(`/products/${productY.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: productY.name })).toBeVisible();
    const [aYRequestData, aYResponse] = await Promise.all([aYRequest, aYResponsePromise]);
    const aYPayload = aYRequestData.postDataJSON() as { productId: string; idempotencyKey: string; userId?: string };
    expect(aYPayload.productId).toBe(productY.id);
    expect(aYPayload.userId).toBeUndefined();
    expect((aYResponse.request().postDataJSON() as { productId: string }).productId).toBe(productY.id);
    expect(aYResponse.status()).toBe(201);

    const aXRequest = interactionRequest(page, productX.id);
    await page.goto(`/products/${productX.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: productX.name })).toBeVisible();
    await aXEntered;
    const aXRequestData = await aXRequest;
    const aXPayload = aXRequestData.postDataJSON() as { productId: string; userId?: string };
    expect(aXPayload.productId).toBe(productX.id);
    expect(aXPayload.userId).toBeUndefined();
    const aAuthorization = aXRequestData.headers().authorization;
    expect(Boolean(aAuthorization && /^Bearer \S+$/.test(aAuthorization))).toBe(true);
    expect(delayedAAuthorization === aAuthorization).toBe(true);
    await logout(page);
    currentOwner = 'B';
    const bBearer = await login(page, customerB);
    await page.goto('/account');
    const bPreferences = await readAuthenticatedJson(page, '/api/me/recommendation-preferences', bBearer);
    expect(bPreferences.status).toBe(200);
    let bPreferenceData = (bPreferences.body as { data: { personalizationEnabled: boolean } }).data;
    const bConsentOffAtGateStart = !bPreferenceData.personalizationEnabled;
    const bRecentOff = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', bBearer);
    expect(bRecentOff.status).toBe(200);
    let bOffHistory = bRecentOff.body as {
      data: { personalizationEnabled: boolean; items: { id: string }[] };
    };
    if (bPreferenceData.personalizationEnabled) {
      await ensureConsentOff(page, true, bBearer);
      bPreferenceData = { personalizationEnabled: false };
      const refreshedRecent = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', bBearer);
      expect(refreshedRecent.status).toBe(200);
      bOffHistory = refreshedRecent.body as typeof bOffHistory;
    }
    expect(bPreferenceData.personalizationEnabled).toBe(false);
    expect(bOffHistory.data).toMatchObject({ personalizationEnabled: false, items: [] });
    await expect(page.getByRole('heading', { name: 'Recently Viewed' })).toHaveCount(0);

    await page.getByRole('switch', { name: 'Personalized recommendations' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Personalized recommendations are on.' })).toBeVisible();
    const bXRequest = interactionRequest(page, productX.id);
    const bXResponsePromise = page.waitForResponse(response => apiPath(response) === '/api/product-interactions' && response.request().method() === 'POST' &&
      (response.request().postDataJSON() as { productId: string }).productId === productX.id);
    await page.goto(`/products/${productX.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: productX.name })).toBeVisible();
    const bRequest = await bXRequest;
    expect((bRequest.postDataJSON() as { idempotencyKey: string }).idempotencyKey).toMatch(/^view:/);
    const bAuthorization = bRequest.headers().authorization;
    expect(Boolean(bAuthorization && /^Bearer \S+$/.test(bAuthorization))).toBe(true);
    expect(bAuthorization !== aAuthorization).toBe(true);
    const bXResponse = await bXResponsePromise;
    expect(bXResponse.status()).toBe(201);

    // Release A's request only after B is active; the captured A Authorization header must still own that event.
    const release = releaseDelayedA;
    releaseDelayedA = undefined;
    release?.();
    const aXResult = await delayedAResponseSettled;
    expect(aXResult).toEqual({ status: 201, recorded: true, reason: null });

    await page.goto('/account');
    const bRecent = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', bBearer);
    expect(bRecent.status).toBe(200);
    const bHistory = (bRecent.body as { data: { items: { id: string; name: string }[] } }).data;
    expect(bHistory.items.map(item => item.id)).toEqual([productX.id]);
    await expect(page.getByRole('heading', { name: productY.name })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: productX.name })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('account-switch-b-1440.png'), fullPage: true, animations: 'disabled' });
    currentOwner = 'A';
    await logout(page);
    const aFinalBearer = await login(page, customerA);
    await page.goto('/account');
    const aRecent = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', aFinalBearer);
    expect(aRecent.status).toBe(200);
    const aHistory = (aRecent.body as { data: { items: { id: string }[] } }).data;
    const aHistoryIds = aHistory.items.map(item => item.id).sort();
    expect(aHistoryIds).toEqual([productX.id, productY.id].sort());
    writeFileSync(testInfo.outputPath('account-switch-evidence.json'), JSON.stringify({
      qaRunId: fixture.runId, userIds: fixture.created.map(user => user.id),
      A: { consentOffAtGateStart: aConsentOffAtGateStart, firstView: productY.id, delayedView: productX.id,
        delayedRequestCompletedAfterBLogin: true, delayedRequestBearerStayedA: delayedAAuthorization === aAuthorization, history: aHistoryIds },
      B: { consentOffAtGateStart: bConsentOffAtGateStart, offHistoryEmpty: true, sameBucketView: productX.id, history: bHistory.items.map(item => item.id) },
    }, null, 2));
  } finally {
    if (releaseDelayedA) {
      abortDelayedAOnCleanup = true;
      const release = releaseDelayedA;
      releaseDelayedA = undefined;
      release();
      await delayedAResponseSettled;
    }
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    if (await page.getByRole('button', { name: /Account menu for QA Customer/ }).isVisible().catch(() => false)) {
      await logout(page).catch(() => undefined);
    }
    await context.close();
  }
});

test('Home recovers from one transient personal AI fallback using the real QA recommender', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await newIsolatedContext(browser, { width: 1440, height: 900 });
  const page = await context.newPage();
  let signedIn = false;
  try {
    await page.goto('/');
    const bearer = await login(page, customerA);
    signedIn = true;
    await page.goto('/account');
    const toggle = page.getByRole('switch', { name: 'Personalized recommendations' });
    if (await toggle.getAttribute('aria-checked') === 'false') {
      await toggle.click();
      await expect(page.getByRole('status').filter({ hasText: 'Personalized recommendations are on.' })).toBeVisible();
    }
    const publicResponse = await page.request.get(`/api/products/${productX.slug}/recommendations?limit=4`);
    expect(publicResponse.ok()).toBe(true);
    const body = await publicResponse.json() as { data: { sections: { items: { product: { id: string; slug: string } }[] }[] } };
    const candidate = body.data.sections.flatMap(section => section.items).map(item => item.product)
      .find(product => product.id !== productX.id && product.id !== productY.id);
    expect(Boolean(candidate)).toBe(true);
    await page.goto(`/products/${candidate!.slug}`);
    await expect.poll(async () => {
      const result = await readAuthenticatedJson(page, '/api/me/recommendations?limit=4', bearer);
      const data = (result.body as { data: { isPersonalized: boolean; embeddingVersion: string | null } }).data;
      return result.status === 200 && data.isPersonalized && data.embeddingVersion === 'siglip2-b16-p256-d1-b3900dd9fad5';
    }, { timeout: 30_000 }).toBe(true);

    let calls = 0;
    await page.route('**/api/me/recommendations?*', async route => {
      calls++;
      if (calls !== 1) { await route.continue(); return; }
      const response = await route.fetch();
      const actual = await response.json() as { data: Record<string, unknown> };
      await route.fulfill({ response, json: { ...actual, data: { ...actual.data, strategy: 'NO_DATA', isPersonalized: false,
        isFallback: true, fallbackReason: 'AI_UNAVAILABLE', items: [], impressionToken: null, profile: null } } });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Recommended for You' })).toBeVisible({ timeout: 30_000 });
    expect(calls).toBe(2);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    if (signedIn) await logout(page).catch(() => undefined);
    await context.close();
  }
});

test('recent history removes an individual item and clears persistently in the disposable browser', async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await newIsolatedContext(browser, { width: 1440, height: 900 });
  const page = await context.newPage();
  let signedIn = false;
  try {
    await page.goto('/');
    const bearer = await login(page, customerA);
    signedIn = true;
    await page.goto('/account');
    const toggle = page.getByRole('switch', { name: 'Personalized recommendations' });
    await ensureConsentOff(page, await toggle.getAttribute('aria-checked') === 'true', bearer);
    await toggle.click();
    await expect(page.getByRole('status').filter({ hasText: 'Personalized recommendations are on.' })).toBeVisible();
    const details = await page.request.get('/api/products/tp-link-archer-ax73');
    expect(details.ok()).toBe(true);
    const third = (await details.json() as { data: { id: string; name: string } }).data;
    for (const product of [productX, productY, { ...third, slug: 'tp-link-archer-ax73' }]) {
      const view = interactionRequest(page, product.id);
      await page.goto(`/products/${product.slug}`);
      await view;
      await expect.poll(async () => {
        const result = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', bearer);
        return (result.body as { data: { items: { id: string }[] } }).data.items.some(item => item.id === product.id);
      }).toBe(true);
    }
    await page.goto('/account');
    await expect(page.getByRole('button', { name: `Remove ${third.name} from recently viewed` })).toBeVisible();
    const before = await readAuthenticatedJson(page, '/api/me/recently-viewed?limit=8', bearer);
    expect((before.body as { data: { items: { id: string }[] } }).data.items.map(item => item.id)).toEqual([third.id, productY.id, productX.id]);
    await page.route('**/api/me/recently-viewed/*', route => route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }));
    await page.getByRole('button', { name: `Remove ${productY.name} from recently viewed` }).click();
    await expect(page.getByText('This product could not be removed. Please try again.')).toBeVisible();
    await expect(page.getByRole('button', { name: `Remove ${productY.name} from recently viewed` })).toBeVisible();
    await page.unroute('**/api/me/recently-viewed/*');
    await page.getByRole('button', { name: `Remove ${productY.name} from recently viewed` }).click();
    await expect(page.getByRole('button', { name: `Remove ${productY.name} from recently viewed` })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: `Remove ${third.name} from recently viewed` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Remove ${productY.name} from recently viewed` })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear recently viewed' }).click();
    await expect(page.getByText('Your recently viewed products were cleared.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Products you open will appear here.')).toBeVisible();
  } finally {
    if (signedIn) {
      const toggle = page.getByRole('switch', { name: 'Personalized recommendations' });
      if (await toggle.isVisible().catch(() => false) && await toggle.getAttribute('aria-checked') === 'true') {
        await toggle.click().catch(() => undefined);
      }
      await logout(page).catch(() => undefined);
    }
    await context.close();
  }
});

test('two browser contexts receive non-shared tokens and persist independent anonymous impressions', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  try {
    const contextA = await newIsolatedContext(browser, { width: 1440, height: 900 });
    const contextB = await newIsolatedContext(browser, { width: 1440, height: 900 });
    contexts.push(contextA, contextB);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const responseAPromise = publicRecommendationResponse(pageA);
    const responseBPromise = publicRecommendationResponse(pageB);
    await Promise.all([pageA.goto(`/products/${productX.slug}`), pageB.goto(`/products/${productX.slug}`)]);
    const [responseA, responseB] = await Promise.all([responseAPromise, responseBPromise]);
    const headersA = responseA.headers();
    const headersB = responseB.headers();
    expect(headersA['cache-control']).toBe('private, no-store');
    expect(headersB['cache-control']).toBe('private, no-store');
    const bodyA = (await responseA.json()).data as { sections: { mode: string; strategy: string; embeddingVersion: string | null; impressionToken: string | null; items: { product: { id: string } }[] }[] };
    const bodyB = (await responseB.json()).data as typeof bodyA;
    const similarA = bodyA.sections.find(section => section.mode === 'SIMILAR_PRODUCTS')!;
    const similarB = bodyB.sections.find(section => section.mode === 'SIMILAR_PRODUCTS')!;
    expect(similarA.strategy).toBe('EMBEDDING_SIMILARITY');
    expect(similarB.strategy).toBe('EMBEDDING_SIMILARITY');
    expect(similarA.embeddingVersion).toBe('siglip2-b16-p256-d1-b3900dd9fad5');
    expect(similarB.embeddingVersion).toBe(similarA.embeddingVersion);
    expect(Boolean(similarA.impressionToken)).toBe(true);
    expect(Boolean(similarB.impressionToken)).toBe(true);
    expect(similarA.impressionToken !== similarB.impressionToken).toBe(true);
    const batchId = (token: string) => JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')).b as string;
    const batchA = batchId(similarA.impressionToken!);
    const batchB = batchId(similarB.impressionToken!);
    expect(batchA).not.toBe(batchB);

    const impressionA = await visibleFirstRecommendation(pageA, similarA.impressionToken!, testInfo, 'recommendations-1440.png');
    const impressionB = await visibleFirstRecommendation(pageB, similarB.impressionToken!, testInfo, 'recommendations-1440-browser-b.png');
    const firstProductId = similarA.items[0]!.product.id;
    expect(similarB.items[0]!.product.id).toBe(firstProductId);
    expect(impressionA.events.some(event => event.productId === firstProductId)).toBe(true);
    expect(impressionB.events.some(event => event.productId === firstProductId)).toBe(true);

    const replay = await pageA.evaluate(async ({ token, productId }) => {
      const response = await fetch('/api/recommendations/events', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, events: [{ productId, type: 'IMPRESSION' }] }) });
      return { status: response.status, body: await response.json() };
    }, { token: similarA.impressionToken!, productId: firstProductId });
    expect(replay.status).toBe(202);
    expect(replay.body.data.accepted).toBe(0);
    const forgedProduct = await pageA.evaluate(async ({ token, productId }) => {
      const response = await fetch('/api/recommendations/events', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, events: [{ productId, type: 'IMPRESSION' }] }) });
      return { status: response.status, body: await response.json() };
    }, { token: similarA.impressionToken!, productId: '00000000-0000-4000-8000-000000000001' });
    expect(forgedProduct.status).toBe(400);
    expect(forgedProduct.body.error.code).toBe('INVALID_RECOMMENDATION_EVENT');
    const forgedToken = await pageB.evaluate(async productId => {
      const response = await fetch('/api/recommendations/events', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'forged-invalid-token-000000', events: [{ productId, type: 'IMPRESSION' }] }) });
      return { status: response.status, body: await response.json() };
    }, firstProductId);
    expect(forgedToken.status).toBe(400);
    expect(forgedToken.body.error.code).toBe('INVALID_RECOMMENDATION_TOKEN');

    await pageA.setViewportSize({ width: 390, height: 844 });
    await loadProductImages(pageA);
    await pageA.screenshot({ path: testInfo.outputPath('recommendations-390.png'), fullPage: true, animations: 'disabled' });
    expect(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const zoomSession = await contextB.newCDPSession(pageB);
    await zoomSession.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 900, deviceScaleFactor: 2, mobile: false });
    const zoomMetrics = await pageB.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, contentWidth: document.documentElement.scrollWidth }));
    expect(zoomMetrics).toEqual({ width: 720, dpr: 2, contentWidth: expect.any(Number) });
    expect(zoomMetrics.contentWidth).toBeLessThanOrEqual(zoomMetrics.width);
    await pageB.evaluate(() => window.scrollTo(0, 0));
    const firstCardB = pageB.getByRole('list', { name: 'Similar Products' }).getByRole('listitem').first();
    const firstName = await firstCardB.getByRole('link').innerText();
    const firstLink = firstCardB.getByRole('link', { name: firstName, exact: true });
    expect(await tabUntilFocused(pageB, firstLink)).toBe(true);
    expect(await firstLink.evaluate(element => element.matches(':focus-visible'))).toBe(true);
    await pageB.screenshot({ path: testInfo.outputPath('recommendations-200pct-emulated.png'), fullPage: true, animations: 'disabled' });
    await zoomSession.send('Emulation.clearDeviceMetricsOverride');
    await zoomSession.detach();
    expect(await pageB.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cartButton = firstCardB.getByRole('button', { name: `Add ${firstName} to cart` });
    await cartButton.click();
    await expect(firstCardB.getByRole('button', { name: `Add ${firstName} to cart` })).toHaveText('Added ✓');
    await expect(firstCardB.getByRole('status').filter({ hasText: `${firstName} added to cart.` })).toBeAttached();
    const wishlistButton = firstCardB.getByRole('button', { name: `Add ${firstName} to wishlist` });
    await wishlistButton.click();
    await expect(firstCardB.getByRole('button', { name: `Remove ${firstName} from wishlist` })).toHaveAttribute('aria-pressed', 'true');
    await firstLink.click();
    await expect(pageB).toHaveURL(new RegExp(`/products/[^/]+$`));
    await expect(pageB.getByRole('heading', { level: 1, name: firstName })).toBeVisible();
    writeFileSync(testInfo.outputPath('attribution-evidence.json'), JSON.stringify({
      qaRunId: fixture.runId, batchIds: [batchA, batchB], firstProductId,
      cacheControl: [headersA['cache-control'], headersB['cache-control']],
      strategies: [similarA.strategy, similarB.strategy], embeddingVersion: similarA.embeddingVersion,
      impressionRowsExpected: 2, replayAccepted: replay.body.data.accepted,
      forgedProductStatus: forgedProduct.status, forgedTokenStatus: forgedToken.status,
      keyboardFocus: true, effective200PercentViewportWidth: zoomMetrics.width, deviceScaleFactor: zoomMetrics.dpr,
      nativeBrowserZoom: false,
      guestCartAction: true, guestWishlistAction: true, productNavigation: pageB.url(),
    }, null, 2));
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('hidden-tab dwell pauses and restarts, and rerender does not duplicate the impression', async ({ browser }, testInfo) => {
  const context = await newIsolatedContext(browser, { width: 390, height: 844 });
  try {
    const page = await context.newPage();
    let frontendImpressionRequests = 0;
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/recommendations/events' && request.method() === 'POST') {
        frontendImpressionRequests += 1;
      }
    });
    const publicResponsePromise = publicRecommendationResponse(page);
    await page.goto(`/products/${productX.slug}`);
    const response = await publicResponsePromise;
    const data = (await response.json()).data as { sections: { mode: string; impressionToken: string | null }[] };
    const token = data.sections.find(section => section.mode === 'SIMILAR_PRODUCTS')!.impressionToken!;
    const similar = page.getByRole('list', { name: 'Similar Products' });
    const firstCard = similar.getByRole('listitem').first();
    await expect(firstCard).toBeVisible();
    // At mobile width the list is much taller than the viewport; center the first card itself, not the entire list.
    await firstCard.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect.poll(async () => page.evaluate(() => document.visibilityState)).toBe('visible');
    await expect.poll(async () => firstCard.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      return height * width / (rect.width * rect.height);
    })).toBeGreaterThanOrEqual(0.5);
    await page.waitForTimeout(450);
    // The headless engine never marks a background page hidden when another context page is foregrounded.
    // Drive the real DOM visibility property + event consumed by the production hook, without changing app code.
    await page.evaluate(() => {
      let state: DocumentVisibilityState = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(window, '__task044SetVisibility', { configurable: true, value: (next: DocumentVisibilityState) => {
        state = next;
        document.dispatchEvent(new Event('visibilitychange'));
      } });
    });
    const setVisibility = (state: DocumentVisibilityState) => page.evaluate(next => {
      const setter = Object.getOwnPropertyDescriptor(window, '__task044SetVisibility')?.value as ((value: DocumentVisibilityState) => void) | undefined;
      if (!setter) throw new Error('Visibility test shim is missing.');
      setter(next);
    }, state);
    await setVisibility('hidden');
    await expect.poll(async () => page.evaluate(() => document.visibilityState)).toBe('hidden');
    await page.waitForTimeout(1300);
    await setVisibility('visible');
    await expect.poll(async () => page.evaluate(() => document.visibilityState)).toBe('visible');
    await expect.poll(async () => firstCard.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      return height * width / (rect.width * rect.height);
    })).toBeGreaterThanOrEqual(0.5);
    await expect.poll(async () => page.evaluate(() => document.visibilityState)).toBe('visible');
    const eventResponse = page.waitForResponse(response => apiPath(response) === '/api/recommendations/events' && response.request().method() === 'POST');
    // Dwell restarted on becoming visible, so after 950 ms the request must still be pending.
    await page.waitForTimeout(850);
    const earlyEvent = await Promise.race([eventResponse.then(() => true), page.waitForTimeout(100).then(() => false)]);
    expect(earlyEvent).toBe(false);
    const visibleEventResponse = await eventResponse;
    expect(visibleEventResponse.status()).toBe(202);
    const payload = visibleEventResponse.request().postDataJSON() as { token: string; events: { productId: string; type: string }[] };
    expect(payload.token === token).toBe(true);
    expect(payload.events.some(event => event.type === 'IMPRESSION')).toBe(true);

    // A real guest cart action rerenders the mounted recommendation card/PDP without leaving the page.
    const firstProductName = await firstCard.getByRole('link').innerText();
    const addToCart = firstCard.getByRole('button', { name: `Add ${firstProductName} to cart` });
    await expect(addToCart).toBeVisible();
    await addToCart.click();
    await expect(firstCard.getByRole('button', { name: `Add ${firstProductName} to cart` })).toHaveText('Added ✓');
    await page.waitForTimeout(1300);
    expect(frontendImpressionRequests).toBe(1);
    const frontendImpressionsAfterRerender = frontendImpressionRequests;

    const replayCount = await page.evaluate(async ({ token, productId }) => {
      const response = await fetch('/api/recommendations/events', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, events: [{ productId, type: 'IMPRESSION' }] }) });
      return (await response.json()).data.accepted as number;
    }, { token, productId: payload.events.find(event => event.type === 'IMPRESSION')!.productId });
    expect(replayCount).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('recommendations-390-dwell.png'), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    writeFileSync(testInfo.outputPath('hidden-dwell-evidence.json'), JSON.stringify({
      qaRunId: fixture.runId, domVisibilityEventVerified: true, nativeBackgroundTransition: false,
      hiddenWaitMs: 1300, preDwellVisibleWaitMs: 450, visibleDwellBeforeFirstEventMs: 950,
      frontendImpressionRequestsAfterRerender: frontendImpressionsAfterRerender, replayAccepted: replayCount,
    }, null, 2));
  } finally {
    await context.close();
  }
});
