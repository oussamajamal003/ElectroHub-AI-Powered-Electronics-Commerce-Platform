import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Account → Recently Viewed "Clear recently viewed" on the ISOLATED stack only (frontend :3200 -> backend :5200 -> disposable
 * PostgreSQL). Signs in as the generated fixture customer, enables personalization, records three real views, and measures the
 * page around the Clear action with mouse and keyboard. Refuses any base URL other than the isolated frontend.
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://localhost:3200';
const credentialsFile = process.env.ISOLATED_FIXTURE_CREDENTIALS
  ?? fileURLToPath(new URL('../../../backend/.isolated-docker/fixture-credentials.txt', import.meta.url));
test.skip(!existsSync(credentialsFile), 'Isolated fixture credentials are not provisioned.');

const CLEAR = { name: 'Clear recently viewed' };

async function signInAndSeedHistory(page: Page): Promise<Record<string, string>> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base)) throw new Error('Refusing: isolated frontend on :3200 only.');
  const credentials = Object.fromEntries(readFileSync(credentialsFile, 'utf8').trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } });
  expect(login.status()).toBe(200);
  const body = await login.json() as { data?: { accessToken?: string }; accessToken?: string };
  const token = body.data?.accessToken ?? body.accessToken;
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };
  const enable = await page.request.patch(`${base}/api/me/recommendation-preferences`, { headers, data: { personalizationEnabled: true } });
  expect(enable.status()).toBe(200);
  const listing = await (await page.request.get(`${base}/api/products`, { headers })).json() as { data?: { id: string }[] };
  const products = listing.data ?? [];
  expect(products.length).toBeGreaterThanOrEqual(3);
  for (const [index, product] of products.slice(0, 3).entries()) {
    const view = await page.request.post(`${base}/api/product-interactions`, {
      headers,
      data: { productId: product.id, eventType: 'VIEW', surface: 'product_detail', idempotencyKey: `clear-scroll-${Date.now()}-${index}` },
    });
    expect(view.status()).toBeLessThan(300);
  }
  return headers;
}

async function measure(page: Page, label: string) {
  const snapshot = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    focused: document.activeElement?.tagName + ':' + (document.activeElement?.textContent ?? '').trim().slice(0, 40),
    panelTop: Math.round(document.querySelector('section[aria-labelledby="personalization-title"]')?.getBoundingClientRect().top ?? -1),
    panelHeight: Math.round(document.querySelector('section[aria-labelledby="personalization-title"]')?.getBoundingClientRect().height ?? -1),
    docHeight: document.documentElement.scrollHeight,
    centerEl: (() => { const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2); return el ? el.tagName + '.' + String(el.className).slice(0, 60) : 'none'; })(),
  }));
  console.log(`MEASURE ${label} ${JSON.stringify(snapshot)}`);
  return snapshot;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`clear recently viewed scroll (${viewport.width}px)`, () => {
    test.use({ viewport });

    for (const mode of ['mouse', 'keyboard'] as const) {
      test(`${mode}: Clear keeps the scroll position and focus stays usable`, async ({ page }) => {
        const headers = await signInAndSeedHistory(page);
        await page.goto(`${base}/account`);
        const clear = page.getByRole('button', CLEAR);
        await expect(clear).toBeVisible({ timeout: 30_000 });
        await clear.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const before = await measure(page, `${viewport.width}-${mode}-before`);

        if (mode === 'mouse') await clear.click();
        else { await clear.focus(); await page.keyboard.press('Enter'); }

        await expect(page.getByRole('button', CLEAR)).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByRole('heading', { name: 'Recently Viewed' })).toBeVisible();
        await page.waitForTimeout(1000);
        const after = await measure(page, `${viewport.width}-${mode}-after`);
        console.log(`MEASURE ${viewport.width}-${mode}-delta ${after.scrollY - before.scrollY}`);
        // Not clamped to the document end, and the empty Recently Viewed heading is in the viewport and focused.
        expect(after.scrollY).toBeLessThan(after.maxScroll - viewport.height / 2);
        const heading = await page.getByRole('heading', { name: 'Recently Viewed' }).boundingBox();
        expect(heading && heading.y >= 0 && heading.y < viewport.height).toBe(true);
        expect(after.focused).toBe('H3:Recently Viewed');
        await page.screenshot({ path: `test-results/isolated/recently-viewed-clear-${mode}-${viewport.width}.png`, fullPage: false });
        await page.request.patch(`${base}/api/me/recommendation-preferences`, { headers, data: { personalizationEnabled: false } });
      });
    }
  });
}
