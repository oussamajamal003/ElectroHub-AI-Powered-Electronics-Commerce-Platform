import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const env = await readFile('../backend/.env', 'utf8');
const lines = env.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
const last = lines.at(-1).trim();
const password = (/^[A-Za-z_][\w]*=/.test(last) ? last.slice(last.indexOf('=') + 1) : last).replace(/^(['"])(.*)\1$/, '$2');
const db = lines.find(line => line.startsWith('DIRECT_URL=')) ?? lines.find(line => line.startsWith('DATABASE_URL='));
assert.ok(db?.includes('pzxekjybdiulzmssalfo') && !db.includes('yepfgjehdstlxbpespun'), 'DEV target required');
const base = 'http://127.0.0.1:3000';
const dir = '.cache/wishlist-live';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const report = { intercepted: false, serverMutations: false, results: [] };
let stage = 'browser setup';
try {
  const auth = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const guest = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const page of [auth, guest]) await page.addInitScript(() => {
    const trace = {};
    new MutationObserver(() => {
      const observedAt = performance.now();
      const loading = document.querySelector('[aria-label="Loading wishlist"]');
      if (loading && !trace.first) trace.first = { at: observedAt, skeletons: document.querySelectorAll('[data-testid="product-skeleton"]').length,
        countLoading: Boolean(document.querySelector('[aria-label="Wishlist count loading"]')), header: document.querySelector('header a[href="/wishlist"]')?.getAttribute('aria-label'),
        falseEmpty: document.querySelector('main')?.textContent?.includes('Your wishlist is empty') ?? false };
      if (document.querySelector('[data-testid="product-card"]') && trace.cards === undefined) trace.cards = observedAt;
      if (/Wishlist \(\d+\)/.test(document.querySelector('header a[href="/wishlist"]')?.getAttribute('aria-label') ?? '') && trace.badge === undefined) trace.badge = observedAt;
      if (/Cart, [1-9]\d*/.test(document.querySelector('header a[href="/cart"]')?.getAttribute('aria-label') ?? '') && trace.cartBadge === undefined) trace.cartBadge = observedAt;
      sessionStorage.setItem('wishlist-test:parity-live', JSON.stringify(trace));
    }).observe(document, { subtree: true, attributes: true, childList: true });
  });
  stage = 'login page';
  await auth.goto(`${base}/wishlist`);
  stage = 'open login';
  await auth.getByRole('button', { name: 'Account', exact: true }).click();
  await auth.getByRole('textbox', { name: 'Email Address' }).fill('jamaloussama003@gmail.com');
  await auth.getByLabel('Password', { exact: true }).fill(password);
  stage = 'login submit';
  const login = auth.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
  await auth.getByRole('dialog').getByRole('button', { name: 'Login', exact: true }).click();
  const response = await login;
  assert.ok(response.ok(), 'Login failed');
  const token = (await response.json()).accessToken;
  assert.ok(token, 'Login needs verification');
  stage = 'read account Wishlist';
  const wishlistResponse = await auth.request.get(`${base}/api/wishlist`, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(wishlistResponse.ok(), 'Wishlist read failed');
  const wishlist = (await wishlistResponse.json()).data;
  const ids = wishlist.items.map(item => item.productId);
  assert.ok(ids.length > 0, 'Existing saved products needed for live comparison');
  stage = 'authenticated initial content';
  report.count = ids.length;
  await auth.goto(`${base}/wishlist`, { waitUntil: 'domcontentloaded' });
  await auth.getByRole('status', { name: `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`, exact: true }).waitFor({ timeout: 45000 });
  stage = 'guest initial content';
  await guest.goto(base);
  await guest.evaluate(ids => localStorage.setItem('electrohub.wishlist.v1', JSON.stringify({ productIds: ids })), ids);
  await guest.goto(`${base}/wishlist`);
  await guest.getByRole('status', { name: `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`, exact: true }).waitFor({ timeout: 45000 });
  stage = 'side by side refresh';
  await Promise.all([auth.reload({ waitUntil: 'domcontentloaded' }), guest.reload({ waitUntil: 'domcontentloaded' })]);
  for (const [mode, page] of [['authenticated', auth], ['guest', guest]]) {
    stage = `${mode} resolved content`;
    await page.getByRole('status', { name: `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`, exact: true }).waitFor({ timeout: 45000 });
    const result = await page.evaluate(() => ({ trace: JSON.parse(sessionStorage.getItem('wishlist-test:parity-live') ?? '{}'),
      network: performance.getEntriesByType('resource').filter(entry => ['/api/wishlist', '/api/wishlist/validate', '/api/cart', '/api/cart/validate', '/api/auth/me', '/api/auth/refresh'].includes(new URL(entry.name).pathname))
        .map(entry => ({ endpoint: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd, duration: entry.duration })) }));
    assert.equal(result.trace.first?.skeletons, Math.min(ids.length, 10));
    assert.equal(result.trace.first?.countLoading, true);
    assert.equal(result.trace.first?.header, 'Wishlist');
    assert.equal(result.trace.first?.falseEmpty, false);
    assert.equal(result.trace.cards, result.trace.badge);
    const endpoint = mode === 'guest' ? '/api/wishlist/validate' : '/api/wishlist';
    assert.equal(result.network.filter(entry => entry.endpoint === endpoint).length, 1);
    const resolved = result.network.find(entry => entry.endpoint === endpoint);
    result.responseToCards = result.trace.cards - resolved.end;
    assert.ok(result.responseToCards < 100, 'Extra frontend loading phase');
    report.results.push({ mode, count: ids.length, ...result });
    await page.screenshot({ path: `${dir}/wishlist-parity-${mode}.png` });
  }
} catch (error) {
  report.stage = stage;
  report.failure = error.name === 'AssertionError' ? error.message : 'Live browser verification could not complete';
  process.exitCode = 1;
} finally {
  await writeFile(`${dir}/wishlist-parity-live.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
