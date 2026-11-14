import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { ADMIN, CUSTOMER, installDarkModeApi, summaries } from './darkMode.fixtures';

/**
 * PR #51 / Task 06.2 WP C + WP D — Product Description layout and account loading skeletons.
 * Every /api call is answered in the browser (darkMode.fixtures); nothing touches a backend, shared database or provider.
 * Loading is made observable by HOLDING the session-restore response (a controlled network delay in the test), never by
 * a delay in application code. Releasing it must replace the skeleton with real content or an actionable error.
 *
 *   npx playwright test -c playwright.task06-2-description-skeletons.config.ts
 *   DESCRIPTION_SKELETONS_ALL_BROWSERS=1 …   adds Firefox and WebKit
 *   DESCRIPTION_SKELETONS_EVIDENCE=1 …       copies screenshots into docs/tasks/Phase-06/evidence/task06.2-description-skeletons/
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(here, '../../../../docs/tasks/Phase-06/evidence/task06.2-description-skeletons');
const WIDTHS = [320, 390, 768, 1024, 1440, 1920] as const;
const CONSENT = JSON.stringify({ version: 1, analytics: false, savedAt: Date.now() });

async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: 'disabled' });
  if (process.env.DESCRIPTION_SKELETONS_EVIDENCE === '1') {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    copyFileSync(file, path.join(EVIDENCE_DIR, `${name}-${info.project.name}.png`));
  }
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.beforeEach(async ({ page }) => {
  // Evidence shows the page, not the first-visit banner: optional analytics declined (the privacy-preserving choice).
  await page.addInitScript(consent => window.localStorage.setItem('electrohub.privacy.v1', consent), CONSENT);
});

/** Holds one endpoint until `release()`; then the installed fixture answers it as usual. */
async function hold(page: Page, pathname: string) {
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  await page.route(url => new URL(url).pathname === pathname, async (route: Route) => { await gate; await route.fallback(); });
  return { release: () => open() };
}

const product = summaries[0]!;

/** QA fixture text (not product data): three paragraphs, a bullet list and six specification rows, as an admin could enter them. */
const longProduct = { ...product, sku: 'QA-LONG-1', modelNumber: null,
  description: [
    'A compact phone built around a bright OLED display and an efficient chip, sized for one-handed use without giving up a full day of battery.',
    'The dual-camera system pairs a wide and an ultra-wide lens. Night mode and stabilised video keep low-light shots usable, and the processor handles editing on the device.',
    '- Fast wired and wireless charging\n- Water and dust resistance\n- Five years of security updates',
    'Every unit ships with a USB-C cable. Cases and chargers are sold separately in the Accessories category.',
  ].join('\n\n'),
  images: [{ id: 'long-0', url: product.primaryImage.url, altText: product.name, sortOrder: 0, isPrimary: true }],
  specifications: [{ group: 'Display', items: [{ id: 's1', name: 'Screen', value: '6.1-inch OLED' }, { id: 's2', name: 'Resolution', value: '2556 x 1179' }] },
    { group: 'Performance', items: [{ id: 's3', name: 'Chip', value: 'A16 Bionic' }, { id: 's4', name: 'Capacity', value: '128GB' },
      { id: 's5', name: 'Battery', value: 'Up to 20 hours video' }, { id: 's6', name: 'Weight', value: '171 g' }] }] };

test.describe('WP C — Product Description', () => {
  for (const width of WIDTHS) {
    test(`long description with specifications at ${width}px stays content-sized and readable`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await installDarkModeApi(page);
      await page.route(url => new URL(url).pathname === `/api/products/${product.slug}`, route => route.fulfill({ json: { data: longProduct } }));
      await page.goto(`/products/${product.slug}`);
      const panel = page.locator('section[aria-labelledby="product-description-title"]');
      await expect(panel.getByRole('heading', { name: 'Product Description' })).toBeVisible();
      await expect(panel.getByRole('listitem')).toHaveCount(3);
      await expect(panel.getByText('2 more in the Specifications tab.')).toBeVisible();
      await panel.scrollIntoViewIfNeeded();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // Long text keeps a readable measure (about 72 characters), never the full 1920px row.
      const measure = await panel.locator('[class*="descriptionCopy"]').evaluate(element => element.getBoundingClientRect().width);
      expect(measure).toBeLessThanOrEqual(820);
      await panel.screenshot({ path: info.outputPath(`description-long-${width}.png`), animations: 'disabled' });
      if (process.env.DESCRIPTION_SKELETONS_EVIDENCE === '1') {
        mkdirSync(EVIDENCE_DIR, { recursive: true });
        copyFileSync(info.outputPath(`description-long-${width}.png`), path.join(EVIDENCE_DIR, `description-long-${width}-${info.project.name}.png`));
      }
    });
  }

  test('a short description without specifications leaves no tall empty block, and markup is shown as text', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installDarkModeApi(page);
    await page.route(url => new URL(url).pathname === `/api/products/${product.slug}`, route => route.fulfill({ json: { data: {
      ...product, description: 'Compact USB-C charger. <img src=x onerror="window.__xss=1">', sku: 'QA-SHORT-1', modelNumber: null,
      images: [{ id: 'short-0', url: product.primaryImage.url, altText: product.name, sortOrder: 0, isPrimary: true }], specifications: [] } } }));
    await page.goto(`/products/${product.slug}`);
    const panel = page.locator('section[aria-labelledby="product-description-title"]');
    await expect(panel.getByText('Compact USB-C charger. <img src=x onerror="window.__xss=1">')).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, '__xss'))).toBeUndefined();
    await expect(panel.getByTestId('description-highlights')).toHaveCount(0);
    // Content-aware: a one-line description does not reserve a tall column.
    expect((await panel.boundingBox())!.height).toBeLessThan(520);
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: info.outputPath('description-short-1440.png'), animations: 'disabled' });
  });

  test('dark mode keeps the description readable', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => window.localStorage.setItem('electrohub:theme:customer', 'dark'));
    await installDarkModeApi(page);
    await page.goto(`/products/${product.slug}`);
    const panel = page.locator('section[aria-labelledby="product-description-title"]');
    await expect(panel).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: info.outputPath('description-dark-1440.png'), animations: 'disabled' });
  });
});

const CUSTOMER_PAGES = [
  { url: '/account', name: 'account' },
  { url: '/account/profile', name: 'profile' },
  { url: '/orders', name: 'orders' },
  { url: '/orders/EH-QA-0001', name: 'order-details' },
  { url: '/orders/EH-QA-0001/tracking', name: 'tracking' },
  { url: '/wishlist', name: 'wishlist' },
] as const;
const ADMIN_PAGES = [
  { url: '/admin/profile', name: 'admin-profile' },
  { url: '/admin/profile/security', name: 'admin-security' },
  { url: '/admin/profile/sessions', name: 'admin-sessions' },
] as const;

test.describe('WP D — account loading skeletons', () => {
  for (const width of [390, 1440] as const) {
    for (const target of CUSTOMER_PAGES) {
      test(`${target.name} at ${width}px: a layout skeleton while the session restores, then content`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await installDarkModeApi(page, { customer: true });
        const restore = await hold(page, '/api/auth/customer/refresh');
        await page.goto(target.url);
        const busy = page.locator('[role="status"][aria-busy="true"], [role="status"][aria-label^="Loading"], [role="status"][aria-label^="Checking"]').first();
        await expect(busy).toBeVisible();
        // No previous user's identity is painted into the placeholder.
        await expect(page.getByText(CUSTOMER.email)).toHaveCount(0);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await shot(page, info, `skeleton-${target.name}-${width}`);
        restore.release();
        await expect(page.locator('[data-account-skeleton]')).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('main, [role="main"], body').first()).not.toHaveAttribute('aria-busy', 'true');
      });
    }
    for (const target of ADMIN_PAGES) {
      test(`${target.name} at ${width}px: a layout skeleton inside the console frame while the administrator session restores`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await installDarkModeApi(page, { admin: true });
        const adminRequests: string[] = [];
        page.on('request', request => { const { pathname } = new URL(request.url()); if (pathname.startsWith('/api/admin/')) adminRequests.push(pathname); });
        const restore = await hold(page, '/api/auth/admin/refresh');
        await page.goto(target.url);
        const skeleton = page.locator('main#admin-main [data-account-skeleton^="admin-"]');
        await expect(skeleton).toBeVisible();
        // The real console frame is already there: header and brand, and the sidebar (desktop) or the navigation button (mobile).
        await expect(page.locator('[data-admin-header]')).toBeVisible();
        await expect(page.getByRole('link', { name: 'ElectroHub admin — Dashboard' })).toBeVisible();
        if (width >= 1024) await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
        else await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
        // Nothing that needs the administrator session is requested or painted before it is verified.
        await expect(page.getByText(ADMIN.email)).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Account menu/ })).toHaveCount(0);
        expect(adminRequests).toEqual([]);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        const headerBefore = await page.locator('[data-admin-header]').boundingBox();
        await shot(page, info, `skeleton-${target.name}-${width}`);
        restore.release();
        await expect(page.locator('[data-account-skeleton]')).toHaveCount(0, { timeout: 15_000 });
        // The frame does not jump when the session resolves.
        await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible();
        expect(await page.locator('[data-admin-header]').boundingBox()).toEqual(headerBefore);
      });
    }
  }

  test('dark mode with reduced motion: the skeleton has no shimmer animation', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.addInitScript(() => window.localStorage.setItem('electrohub:theme:customer', 'dark'));
    await installDarkModeApi(page, { customer: true });
    const restore = await hold(page, '/api/auth/customer/refresh');
    await page.goto('/account');
    const skeleton = page.locator('[data-account-skeleton="account"]');
    await expect(skeleton).toBeVisible();
    expect(await skeleton.evaluate(root => [...root.querySelectorAll('*')].every(node => getComputedStyle(node, '::after').animationName === 'none'))).toBe(true);
    await shot(page, info, 'skeleton-account-dark-reduced-motion-1440');
    restore.release();
  });

  test('a session check that never resolves to a verdict ends in an actionable error, not an endless skeleton', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDarkModeApi(page, { customer: true });
    await page.route(url => new URL(url).pathname === '/api/auth/customer/refresh',
      route => route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' } } }));
    await page.goto('/account');
    await expect(page.getByText('We could not verify your session.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect(page.locator('[data-account-skeleton]')).toHaveCount(0);
    await shot(page, info, 'skeleton-account-session-error-1440');
  });
});
