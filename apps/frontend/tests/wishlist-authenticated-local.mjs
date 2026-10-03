import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const envText = await readFile('../backend/.env', 'utf8');
const lines = envText.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
const last = lines.at(-1).trim();
const password = (/^[A-Za-z_][\w]*=/.test(last) ? last.slice(last.indexOf('=') + 1) : last).replace(/^(['"])(.*)\1$/, '$2');
const databaseLine = lines.find(line => line.startsWith('DIRECT_URL=')) ?? lines.find(line => line.startsWith('DATABASE_URL='));
if (!databaseLine?.includes('pzxekjybdiulzmssalfo') || databaseLine.includes('yepfgjehdstlxbpespun')) throw new Error('Expected DEV target was not confirmed.');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const base = 'http://127.0.0.1:3000';
const outputDirectory = '.cache/wishlist-live';
const report = { intercepted: false, target: 'DEV localhost', measurements: [], stableRefreshCycles: [], restored: false };
let stage = 'login';
let token;
let original;
const api = async (path, method = 'GET', data) => {
  const response = await page.request.fetch(`${base}/api/${path}`, { method, data, headers: { Authorization: `Bearer ${token}` }, timeout: 45000 });
  if (!response.ok()) throw new Error(`API status ${response.status()}`);
  return response.json();
};
const syncItems = async desired => {
  const current = (await api('wishlist')).data.items.map(item => item.productId);
  for (const id of current.filter(id => !desired.includes(id))) await api(`wishlist/items/${id}`, 'DELETE');
  for (const id of desired.filter(id => !current.includes(id))) await api('wishlist/items', 'POST', { productId: id });
};
await mkdir(outputDirectory, { recursive: true });
try {
  await page.addInitScript(() => {
    const timing = {};
    const observer = new MutationObserver(() => {
      const loading = document.querySelector('[aria-label="Loading wishlist"]');
      const header = document.querySelector('header a[href="/wishlist"]');
      if (loading && !timing.initial) timing.initial = { at: performance.now(), skeletons: document.querySelectorAll('[data-testid="product-skeleton"]').length,
        countLoading: Boolean(document.querySelector('[aria-label="Wishlist count loading"]')), badge: header?.getAttribute('aria-label'), falseEmpty: Boolean(document.querySelector('main h2')?.textContent?.includes('Your wishlist is empty')) };
      if (document.querySelector('[data-testid="product-card"]') && timing.cards === undefined) timing.cards = performance.now();
      if (/Wishlist \(\d+\)/.test(header?.getAttribute('aria-label') ?? '') && timing.wishlistBadge === undefined) timing.wishlistBadge = performance.now();
      const cart = document.querySelector('header a[href="/cart"]');
      if (/Cart, [1-9]\d*/.test(cart?.getAttribute('aria-label') ?? '') && timing.cartBadge === undefined) timing.cartBadge = performance.now();
      sessionStorage.setItem('wishlist-test:live-timing', JSON.stringify(timing));
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto(`${base}/wishlist`);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill('jamaloussama003@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
  await page.getByRole('dialog').getByRole('button', { name: 'Login', exact: true }).click();
  const loginResult = await login;
  if (!loginResult.ok()) throw new Error(`Login status ${loginResult.status()}`);
  token = (await loginResult.json()).accessToken;
  if (!token) throw new Error('Login needs additional verification.');
  stage = 'save original Wishlist';
  original = (await api('wishlist')).data.items.map(item => item.productId);
  report.cartCount = (await api('cart')).data.totalQuantity;
  const catalog = (await api('products?page=1&pageSize=20')).data;
  const products = catalog.filter(product => product.availability === 'AVAILABLE').slice(0, 12);
  if (products.length < 12) throw new Error('Twelve available products are required.');
  await syncItems(products.slice(0, 2).map(product => product.id));
  const measure = async (name, count, reload = true) => {
    let requests = 0;
    const onRequest = request => { if (new URL(request.url()).pathname === '/api/wishlist' && request.method() === 'GET') requests++; };
    page.on('request', onRequest);
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('product-card').first().waitFor({ timeout: 45000 });
    await page.waitForFunction(expected => document.querySelectorAll('[data-testid="product-card"]').length === expected, count, { timeout: 45000 });
    const timing = await page.evaluate(() => ({ ...JSON.parse(sessionStorage.getItem('wishlist-test:live-timing') ?? '{}'),
      network: performance.getEntriesByType('resource').filter(entry => /\/api\/(wishlist|cart|auth\/me|auth\/refresh|search\/products)(?:\?|$)/.test(new URL(entry.name).pathname))
        .map(entry => ({ endpoint: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd, duration: entry.duration })) }));
    const countLabel = await page.getByRole('status', { name: `${count} ${count === 1 ? 'item' : 'items'}`, exact: true }).count();
    const badge = await page.locator('header').getByRole('link', { name: `Wishlist (${count})`, exact: true }).count();
    assert.equal(timing.initial?.skeletons, Math.min(count, 10), 'First-frame skeleton count differs');
    assert.equal(timing.initial?.falseEmpty, false, 'False empty on first frame');
    assert.equal(timing.initial?.countLoading, true, 'Loading count label must remain a skeleton');
    assert.equal(timing.initial?.badge, 'Wishlist', 'Unresolved Wishlist badge must stay hidden');
    assert.equal(requests, 1, 'Refresh issued a duplicate Wishlist GET');
    assert.equal(countLabel, 1, 'Resolved count label differs');
    assert.equal(badge, 1, 'Resolved Wishlist badge differs');
    const wishlistResponse = timing.network.find(entry => entry.endpoint === '/api/wishlist');
    assert.ok(timing.cards - wishlistResponse.end < 100, 'Unnecessary post-response skeleton delay');
    if (report.cartCount === 0) assert.equal(await page.locator('header a[href="/cart"] span').count(), 0, 'Empty Cart must not show a badge');
    report.measurements.push({ name, expectedCount: count, requests, timing, countLabelCorrect: countLabel === 1, badgeCorrect: badge === 1 });
    await page.screenshot({ path: `${outputDirectory}/wishlist-live-${name}.png` });
    page.off('request', onRequest);
  };
  stage = 'add two to three';
  await page.goto(`${base}/products?page=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('header').getByRole('link', { name: 'Wishlist (2)', exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: `Add ${products[2].name} to wishlist`, exact: true }).first().click();
  await page.locator('header').getByRole('link', { name: 'Wishlist (3)', exact: true }).waitFor();
  await page.waitForFunction(() => { const user = JSON.parse(sessionStorage.getItem('electrohub:cached-user') ?? 'null'); return user && JSON.parse(sessionStorage.getItem(`electrohub.wishlist.auth-count.v1:${user.id}`) ?? 'null')?.count === 3; });
  await page.locator('header').getByRole('link', { name: 'Wishlist (3)', exact: true }).click();
  await page.getByRole('status', { name: '3 items', exact: true }).waitFor();
  await measure('add-refresh', 3);
  stage = 'ten stable hard refreshes';
  const expectedIds = (await api('wishlist')).data.items.map(item => item.productId).sort();
  const idBySlug = new Map(products.map(product => [product.slug, product.id]));
  const renderedIds = async () => (await page.getByTestId('product-card').evaluateAll(cards => cards.map(card => {
    const href = card.querySelector('a[href^="/products/"]')?.getAttribute('href');
    return href?.split('/').at(-1) ?? null;
  }))).map(slug => idBySlug.get(slug) ?? `UNMAPPED:${slug}`).sort();
  for (let cycle = 1; cycle <= 10; cycle++) {
    const beforeIds = (await api('wishlist')).data.items.map(item => item.productId).sort();
    assert.deepEqual(beforeIds, expectedIds, `Cycle ${cycle}: server IDs changed before reload`);
    const getAfterReload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/wishlist' && response.request().method() === 'GET');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const responseIds = (await (await getAfterReload).json()).data.items.map(item => item.productId).sort();
    await page.waitForFunction(expected => document.querySelectorAll('[data-testid="product-card"]').length === expected, expectedIds.length, { timeout: 45000 });
    const finalIds = await renderedIds();
    const afterIds = (await api('wishlist')).data.items.map(item => item.productId).sort();
    assert.deepEqual(responseIds, expectedIds, `Cycle ${cycle}: refresh GET IDs changed`);
    assert.deepEqual(afterIds, expectedIds, `Cycle ${cycle}: server IDs changed after refresh`);
    assert.deepEqual(finalIds, expectedIds, `Cycle ${cycle}: rendered IDs changed after refresh`);
    report.stableRefreshCycles.push({ cycle, beforeIds, getIds: responseIds, renderedIds: finalIds, afterIds });
  }
  stage = 'remove three to two';
  await page.getByRole('button', { name: `Remove ${products[2].name} from wishlist`, exact: true }).click();
  await page.waitForFunction(() => { const user = JSON.parse(sessionStorage.getItem('electrohub:cached-user') ?? 'null'); return user && JSON.parse(sessionStorage.getItem(`electrohub.wishlist.auth-count.v1:${user.id}`) ?? 'null')?.count === 2; });
  await measure('remove-refresh', 2);
  stage = 'zero to one refresh';
  await syncItems([]);
  await page.goto(`${base}/products?page=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const user = JSON.parse(sessionStorage.getItem('electrohub:cached-user') ?? 'null'); return user && JSON.parse(sessionStorage.getItem(`electrohub.wishlist.auth-count.v1:${user.id}`) ?? 'null')?.count === 0; }, null, { timeout: 45000 });
  await page.getByRole('button', { name: `Add ${products[0].name} to wishlist`, exact: true }).first().waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: `Add ${products[0].name} to wishlist`, exact: true }).first().click();
  await page.waitForFunction(() => { const user = JSON.parse(sessionStorage.getItem('electrohub:cached-user') ?? 'null'); return user && JSON.parse(sessionStorage.getItem(`electrohub.wishlist.auth-count.v1:${user.id}`) ?? 'null')?.count === 1; });
  await page.locator('header').getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await measure('zero-add-refresh', 1);
  stage = 'twelve item refresh';
  await syncItems(products.map(product => product.id));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('status', { name: '12 items', exact: true }).waitFor({ timeout: 45000 });
  await measure('twelve-refresh', 12);
  stage = 'Products comparison';
  await page.goto(`${base}/products?page=1`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('product-card').first().waitFor({ timeout: 45000 });
  report.products = await page.evaluate(() => ({ ...JSON.parse(sessionStorage.getItem('wishlist-test:live-timing') ?? '{}'),
    network: performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname === '/api/search/products').map(entry => ({ duration: entry.duration, end: entry.responseEnd })) }));
} catch (error) {
  report.failure = { stage, reason: error.message.includes('status') ? error.message : error.name === 'AssertionError' ? error.message : 'Browser acceptance did not complete' };
  process.exitCode = 1;
} finally {
  if (original && token) { try { await syncItems(original); report.restored = true; } catch { report.restoreFailure = true; process.exitCode = 1; } }
  await writeFile(`${outputDirectory}/wishlist-authenticated-local.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
