import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 04.4 — Frequently Bought Together on the Cart, ISOLATED stack only (frontend :3200 -> backend :5200 -> disposable PostgreSQL).
 * Requires the temporary qualifying orders seeded for this run (A+B and C+D, paid, two each) and the state file they were written to.
 * Refuses any base URL other than the isolated frontend. Never targets shared DEV.
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://localhost:3200';
// Defaults to the generated fixture credentials of the disposable stack (apps/backend/.isolated-docker), never shared DEV.
const credentialsFile = process.env.ISOLATED_FIXTURE_CREDENTIALS
  ?? fileURLToPath(new URL('../../../backend/.isolated-docker/fixture-credentials.txt', import.meta.url));
const seedScript = fileURLToPath(new URL('../../../backend/scripts/fbt-cart-qa-seed.cjs', import.meta.url));
test.skip(!existsSync(credentialsFile), 'Isolated fixture credentials are not provisioned.');

type Product = { id: string; name: string; slug: string };
type Fixture = { products: Record<'a' | 'b' | 'c' | 'd', Product> };
// Set by beforeAll from the temporary orders this run wrote on the disposable database.
let state: Fixture | undefined;

function runSeed(mode: 'seed' | 'reset' | 'cleanup'): string {
  return execFileSync(process.execPath, [seedScript, mode], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function signIn(page: Page) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base)) throw new Error('Refusing: isolated frontend on :3200 only.');
  const credentials = Object.fromEntries(readFileSync(credentialsFile!, 'utf8').trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } });
  expect(login.status()).toBe(200);
}

async function addFromProduct(page: Page, product: Product) {
  await page.goto(`${base}/products/${encodeURIComponent(product.slug)}`);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/cart/.test(r.url())),
    page.getByRole('button', { name: /^Add to Cart$/ }).first().click(),
  ]);
  expect(response.status()).toBeLessThan(300);
}

function fbtSection(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Frequently Bought Together' }) });
}

// 200% zoom is modelled as a 720 CSS px viewport at device scale factor 2 (1440 device px).
const viewports = [
  { label: '1440px', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { label: '768px', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 },
  { label: '390px', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
  { label: '200% zoom', viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 },
];
for (const { label, viewport, deviceScaleFactor } of viewports) {
  test.describe(`cart FBT (${label})`, () => {
    test.use({ viewport, deviceScaleFactor });
    test.beforeAll(() => { state = JSON.parse(runSeed('seed')) as Fixture; });
    test.afterAll(() => { runSeed('cleanup'); state = undefined; });
    test.beforeEach(() => { if (state) runSeed('reset'); });

    test('positive: correct candidate, no in-cart product, no duplicate, Add to Cart, no automatic mutation', async ({ page }) => {
      test.skip(!state, 'FBT state missing');
      await signIn(page);
      await addFromProduct(page, state!.products.a);

      // Count cart-mutating requests while only viewing the cart: must be zero.
      let mutations = 0;
      page.on('request', request => { if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && /\/api\/cart/.test(request.url())) mutations += 1; });
      await page.goto(`${base}/cart`);
      const section = fbtSection(page);
      await expect(section).toBeVisible({ timeout: 30_000 });
      await expect(section.getByText(state!.products.b.name, { exact: true })).toHaveCount(1);
      await expect(section.getByText(state!.products.a.name, { exact: true })).toHaveCount(0);
      await expect(section.getByText(state!.products.c.name, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.waitForTimeout(1000);
      expect(mutations).toBe(0);

      const linesBefore = await page.locator('[class*="line"]').count();
      await section.getByRole('button', { name: /^Add .+ to cart$/ }).first().click();
      await expect(page.getByText(state!.products.b.name).first()).toBeVisible();
      await expect(section.getByText(state!.products.b.name, { exact: true })).toHaveCount(0, { timeout: 30_000 });
      const linesAfter = await page.locator('[class*="line"]').count();
      expect(linesAfter).toBeGreaterThan(linesBefore);
      await page.screenshot({ path: `test-results/isolated/fbt-cart-positive-${viewport.width}.png`, fullPage: true });
    });

    test('stale anchor: previous cart cards are not shown while the changed cart is in flight', async ({ page }) => {
      test.skip(!state, 'FBT state missing');
      await signIn(page);
      // Ensure cart contains A and the FBT cards for [A] show B.
      await addFromProduct(page, state!.products.a);
      await page.goto(`${base}/cart`);
      await expect(fbtSection(page).getByText(state!.products.b.name, { exact: true })).toBeVisible({ timeout: 30_000 });

      // Hold only the response for the changed cart (it contains C) until released.
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let held = 0;
      await page.route('**/api/recommendations/cart', async route => {
        const body = route.request().postData() ?? '';
        if (!body.includes(state!.products.c.id)) return route.fallback();
        held += 1;
        await gate;
        return route.fallback();
      });
      await addFromProduct(page, state!.products.c);
      await page.goto(`${base}/cart`);
      await expect.poll(() => held, { timeout: 30_000 }).toBeGreaterThan(0);
      // While the new cart's response is pending, the previous [A] card (B) must not be shown.
      await expect(page.getByText(state!.products.b.name, { exact: true })).toHaveCount(0);
      release();
      await page.unroute('**/api/recommendations/cart');
      const section = fbtSection(page);
      await expect(section.getByText(state!.products.d.name, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(section.getByText(state!.products.c.name, { exact: true })).toHaveCount(0);
      await page.screenshot({ path: `test-results/isolated/fbt-cart-stale-anchor-${viewport.width}.png`, fullPage: true });
    });

    test('delayed failure: a failed changed-cart request shows no previous cards and the cart stays usable', async ({ page }) => {
      test.skip(!state, 'FBT state missing');
      await signIn(page);
      await addFromProduct(page, state!.products.a);
      await page.goto(`${base}/cart`);
      await expect(fbtSection(page).getByText(state!.products.b.name, { exact: true })).toBeVisible({ timeout: 30_000 });

      // Fail only the changed-cart response (it contains C) after a delay.
      let failed = 0;
      await page.route('**/api/recommendations/cart', async route => {
        const body = route.request().postData() ?? '';
        if (!body.includes(state!.products.c.id)) return route.fallback();
        failed += 1;
        await new Promise(resolve => setTimeout(resolve, 2_000));
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'fixture' } }) });
      });
      await addFromProduct(page, state!.products.c);
      await page.goto(`${base}/cart`);
      await expect.poll(() => failed, { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(page.getByText(state!.products.b.name, { exact: true })).toHaveCount(0);
      await page.waitForTimeout(3_000);
      // Rail stays absent after the failure (no stale B) and the cart lines remain visible and correct.
      await expect(page.getByText(state!.products.b.name, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Proceed to Checkout' }).or(page.getByRole('button', { name: 'Sign in to Checkout' }))).toBeVisible();
      await page.unroute('**/api/recommendations/cart');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/isolated/fbt-cart-delayed-failure-${viewport.width}.png`, fullPage: true });
    });
  });
}

test.describe('cart FBT keyboard and reduced motion (1440px)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  test.beforeAll(() => { state = JSON.parse(runSeed('seed')) as Fixture; });
  test.afterAll(() => { runSeed('cleanup'); state = undefined; });
  test.beforeEach(() => { if (state) runSeed('reset'); });

  test('keyboard: the rail Add to Cart is reachable with visible focus and activates with Enter', async ({ page }) => {
    test.skip(!state, 'FBT state missing');
    await signIn(page);
    await addFromProduct(page, state!.products.a);
    await page.goto(`${base}/cart`);
    const section = fbtSection(page);
    await expect(section.getByText(state!.products.b.name, { exact: true })).toBeVisible({ timeout: 30_000 });
    const button = section.getByRole('button', { name: /^Add .+ to cart$/ }).first();
    await button.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(button).toBeFocused();
    const outline = await button.evaluate(element => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe('none');
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/cart/.test(r.url())),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBeLessThan(300);
    await expect(section.getByText(state!.products.b.name, { exact: true })).toHaveCount(0, { timeout: 30_000 });
  });

  test('reduced motion: the rail renders its content with no animation running', async ({ page }) => {
    test.skip(!state, 'FBT state missing');
    await signIn(page);
    await addFromProduct(page, state!.products.a);
    await page.goto(`${base}/cart`);
    const section = fbtSection(page);
    await expect(section.getByText(state!.products.b.name, { exact: true })).toBeVisible({ timeout: 30_000 });
    const running = await section.evaluate(element => [...element.querySelectorAll('*')].filter(node => {
      const style = getComputedStyle(node);
      return style.animationName !== 'none' && style.animationPlayState === 'running';
    }).length);
    expect(running).toBe(0);
    const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(reduced).toBe(true);
  });
});
