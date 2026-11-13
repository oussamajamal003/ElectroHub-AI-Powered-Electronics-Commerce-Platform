import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDarkModeApi } from './darkMode.fixtures';

/**
 * Task 06.2 (parallel) — premium dark mode across the customer storefront and admin console.
 * Synthetic API only (darkMode.fixtures.ts): no backend, DEV database, Stripe or map tiles are contacted.
 * Run: npx playwright test -c playwright.dark-mode.config.ts [--project=chromium|firefox|webkit]
 */
const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const LEAFLET_CSS = require.resolve('leaflet/dist/leaflet.css');
const CAPTURE = process.env.EH_DARK_MODE_CAPTURE === '1';
const captures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/dark-mode/captures');
if (CAPTURE) mkdirSync(captures, { recursive: true });

type Theme = 'light' | 'dark';
const KEY = 'electrohub:theme:customer';
const ADMIN_KEY = 'electrohub:theme:admin';
const keyForRoute = (route: string) => /^\/admin(?:\/|$)/.test(route) ? ADMIN_KEY : KEY;

const CUSTOMER_ROUTES = ['/', '/products', '/products/apple-iphone-15-128gb', '/search?q=apple', '/cart', '/wishlist', '/orders', '/account',
  '/account/profile', '/about', '/contact', '/route-that-does-not-exist'];
const ADMIN_ROUTES = ['/admin', '/admin/products', '/admin/products/new', '/admin/categories', '/admin/inventory', '/admin/orders',
  '/admin/customers', '/admin/deliveries', '/admin/recommendations', '/admin/analytics', '/admin/settings', '/admin/settings/administrators',
  '/admin/profile', '/admin/profile/security', '/admin/profile/sessions', '/admin/route-that-does-not-exist'];
const PUBLIC_ADMIN_ROUTES = ['/admin/login', '/admin/forgot-password'];

const isAdmin = (route: string) => route.startsWith('/admin') && !PUBLIC_ADMIN_ROUTES.includes(route);

async function open(page: Page, route: string, theme: Theme | null) {
  await installDarkModeApi(page, { customer: !route.startsWith('/admin'), admin: isAdmin(route) });
  if (theme) await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('eh-seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('eh-seeded', '1'); } }, [keyForRoute(route), theme] as const);
  await page.goto(route);
  await expect(page.locator('main, [role="main"], form').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Scrolls through the page so lazily revealed sections render before an audit. */
async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.8) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    // Audit settled colours only: wait for every running animation/transition (reveal fades, menus) to finish.
    await Promise.race([Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 2000))]);
  });
  await page.waitForTimeout(300);
}

/**
 * Finds sizeable opaque surfaces that stayed light in dark mode (the classic "white card on a dark page" defect).
 * Media and the documented product-photo well are excluded: product photography is shot on light backgrounds by design.
 */
async function lightSurfaces(page: Page) {
  return page.evaluate(() => {
    const lum = (r: number, g: number, b: number) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const found: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (element.closest('img, picture, video, canvas, svg, iframe, [data-image-well], .leaflet-tile-pane')) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const match = style.backgroundColor.match(/rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?/);
      if (!match || Number(match[4] ?? 1) < 0.85) continue;
      const box = element.getBoundingClientRect();
      if (box.width * box.height < 1600 || box.width < 24) continue;
      const [r, g, b] = [match[1], match[2], match[3]].map(Number);
      if (r === 233 && g === 238 && b === 245) continue; // --eh-color-image-well (product-photo well), documented exception
      // Near-white/grey (low-saturation) only: vivid brand and state fills (primary, accent, success…) are intentional in both themes.
      if (lum(r, g, b) > 0.45 && Math.max(r, g, b) - Math.min(r, g, b) < 48) found.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} ${style.backgroundColor} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    return found;
  });
}

/** Contrast violations present in dark mode but not in light mode on the same page: theme-induced regressions only. */
async function newDarkContrastViolations(page: Page) {
  const dark = await contrastViolations(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  const light = new Set((await contrastViolations(page)).map(item => item.split(' — ')[0]));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  return { added: dark.filter(item => !light.has(item.split(' — ')[0])), preExisting: dark.filter(item => light.has(item.split(' — ')[0])) };
}

async function contrastViolations(page: Page) {
  if (!await page.evaluate(() => 'axe' in window)) await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }[] }> } }).axe;
    await Promise.race([Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 2000))]);
    const result = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] });
    return result.violations.flatMap(violation => violation.nodes.map(node => `${node.target.join(' ')} — ${node.any[0]?.message ?? violation.id}`));
  });
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const appliedTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const DARK_BODY = 'rgb(17, 26, 45)';
const LIGHT_BODY = 'rgb(255, 255, 255)';

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  // Firefox/WebKit report a lazy route chunk whose import is cancelled by a reload/navigation in the Vite dev server. The same error
  // reproduces on the pre-dark-mode baseline (9cae864) without any theme code, so it is excluded here and reported separately.
  page.on('pageerror', error => { if (!/error loading dynamically imported module|Importing a module script failed/.test(error.message)) errors.push(`pageerror: ${error.message}`); });
  // Socket.IO live updates have no server in fixture mode; that transport noise is environmental, not a UI error.
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|status of 4\d\d|socket\.io/.test(message.text())) errors.push(message.text()); });
  return errors;
}

// ─── Theme switching, persistence and the header toggles ─────────────────────────────────────────

test.describe('theme preference and header toggles', () => {
  test('customer header toggle switches instantly, survives navigation, reload and the storefront ↔ admin transition', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await installDarkModeApi(page, { customer: true, admin: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
    expect(await appliedTheme(page)).toBe('light');
    expect(await bodyBackground(page)).toBe(LIGHT_BODY);

    const banner = page.getByRole('banner');
    await banner.getByRole('button', { name: 'Switch to dark mode' }).click();
    expect(await appliedTheme(page)).toBe('dark');
    expect(await bodyBackground(page)).toBe(DARK_BODY);
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe('dark');
    await expect(banner.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle'); // never reload while a lazy route chunk is still importing
    expect(await appliedTheme(page)).toBe('dark');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await appliedTheme(page)).toBe('dark');

    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    expect(await appliedTheme(page)).toBe('light');
    const adminHeader = page.locator('[data-admin-header]');
    await adminHeader.getByRole('button', { name: 'Switch to dark mode' }).click();
    expect(await appliedTheme(page)).toBe('dark');
    await adminHeader.getByRole('button', { name: 'Switch to light mode' }).click();
    expect(await appliedTheme(page)).toBe('light');
    await page.waitForLoadState('networkidle');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(await appliedTheme(page)).toBe('dark');
    expect(errors).toEqual([]);
  });

  test('without a saved choice the system preference decides; an explicit choice then wins', async ({ page }) => {
    await installDarkModeApi(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/about');
    expect(await appliedTheme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => appliedTheme(page)).toBe('light'); // still following the system
    await page.getByRole('banner').getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    expect(await appliedTheme(page)).toBe('dark');
  });

  test('an invalid stored value falls back to the system preference without errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await installDarkModeApi(page);
    await page.addInitScript(key => localStorage.setItem(key, '"neon"'), KEY);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/contact');
    expect(await appliedTheme(page)).toBe('dark');
    expect(errors).toEqual([]);
  });

  test('a dark reload applies the theme before first paint (no light flash)', async ({ page }) => {
    await installDarkModeApi(page);
    await page.addInitScript(key => {
      localStorage.setItem(key, 'dark');
      document.addEventListener('DOMContentLoaded', () => {
        const w = window as unknown as Record<string, unknown>;
        w.__themeAtDcl = document.documentElement.getAttribute('data-theme');
        w.__bgAtDcl = getComputedStyle(document.body).backgroundColor;
      });
    }, KEY);
    await page.goto('/about');
    const [themeAtDcl, bgAtDcl] = await page.evaluate(() => { const w = window as unknown as Record<string, unknown>; return [w.__themeAtDcl, w.__bgAtDcl]; });
    expect(themeAtDcl).toBe('dark');
    expect(bgAtDcl).not.toBe(LIGHT_BODY);
    // The initialiser is a classic, render-blocking, same-origin <script> in <head>, ahead of every stylesheet and the app entry module.
    // (Vite's dev server prepends its own client/preamble modules; those are dev-only and excluded.)
    const head = await page.evaluate(() => Array.from(document.head.querySelectorAll('script, link[rel="stylesheet"], style'))
      .filter(node => !(node instanceof HTMLScriptElement && node.type === 'module' && !/\/src\/main\.tsx|\/assets\//.test(node.getAttribute('src') ?? '')))
      .map(node => node instanceof HTMLScriptElement ? `script:${node.getAttribute('src')}:${node.type || 'classic'}:${node.async || node.defer}` : 'style'));
    expect(head[0]).toBe('script:/theme-init.js:classic:false');
  });

  test('storefront and admin tabs keep independent preferences', async ({ context }) => {
    const storefront = await context.newPage();
    const admin = await context.newPage();
    await installDarkModeApi(storefront);
    await installDarkModeApi(admin, { admin: true });
    await storefront.emulateMedia({ colorScheme: 'light' });
    await admin.emulateMedia({ colorScheme: 'light' });
    await storefront.goto('/about');
    await admin.goto('/admin');
    await expect(admin.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await storefront.getByRole('banner').getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect.poll(() => appliedTheme(admin)).toBe('light');
    await admin.locator('[data-admin-header]').getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect.poll(() => appliedTheme(storefront)).toBe('dark');
    await admin.locator('[data-admin-header]').getByRole('button', { name: 'Switch to light mode' }).click();
    await expect.poll(() => appliedTheme(storefront)).toBe('dark');
  });

  test('switching keeps form input, session and cached data (no refetch, no remount)', async ({ page }) => {
    await installDarkModeApi(page, { admin: true });
    let listRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/catalog/products') listRequests += 1; });
    await page.goto('/admin/products');
    await expect(page.getByRole('cell', { name: /Apple iPhone 15 128GB/ }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const before = listRequests;
    const search = page.getByRole('searchbox').first();
    await search.fill('draft text');
    const toggle = page.locator('[data-admin-header]').locator('[data-theme-toggle]');
    await toggle.click();
    await toggle.click();
    await toggle.click();
    expect(await appliedTheme(page)).toBe('dark');
    await expect(search).toHaveValue('draft text');
    await expect(page.getByRole('button', { name: /Account menu for QA Administrator/ })).toBeVisible();
    await page.waitForTimeout(400);
    // Only the debounced search may query; the theme switches themselves trigger nothing.
    expect(listRequests - before).toBeLessThanOrEqual(1);
  });

  test('the toggle is keyboard operable with a visible focus ring in both themes', async ({ page }) => {
    await open(page, '/about', 'dark');
    const toggle = page.getByRole('banner').locator('[data-theme-toggle]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    expect(await appliedTheme(page)).toBe('light');
    for (const theme of ['light', 'dark'] as const) {
      if (await appliedTheme(page) !== theme) await page.keyboard.press(' ');
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // :focus-visible from keyboard modality
      await expect(toggle).toBeFocused();
      const outline = await toggle.evaluate(element => { const style = getComputedStyle(element); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }; });
      expect(outline.style, `focus ring in ${theme}`).not.toBe('none');
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── Responsive placement and layout stability ───────────────────────────────────────────────────

test.describe('responsive header placement', () => {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    test(`${width}px: toggle visible in both headers, no overflow and no theme-induced layout shift`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/products', '/admin/orders']) {
        await open(page, route, 'light');
        const header = route.startsWith('/admin') ? page.locator('[data-admin-header]') : page.getByRole('banner');
        const toggle = header.locator('[data-theme-toggle]');
        await expect(toggle).toBeVisible();
        const box = (await toggle.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.width).toBeGreaterThanOrEqual(width <= 820 && !route.startsWith('/admin') ? 32 : 40);
        const lightLayout = await header.evaluate(element => Array.from(element.querySelectorAll('a, button')).map(node => node.getBoundingClientRect())
          .map(rect => `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`));
        await toggle.click();
        expect(await appliedTheme(page)).toBe('dark');
        const darkLayout = await header.evaluate(element => Array.from(element.querySelectorAll('a, button')).map(node => node.getBoundingClientRect())
          .map(rect => `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`));
        expect(darkLayout).toEqual(lightLayout);
        expect(await noHorizontalOverflow(page), `${route} overflows at ${width}px`).toBe(true);
        await page.evaluate(key => localStorage.removeItem(key), keyForRoute(route));
      }
    });
  }
});

// ─── Portals and third-party UI ──────────────────────────────────────────────────────────────────

test.describe('portals and third-party surfaces in dark mode', () => {
  const background = (page: Page, selector: string) => page.locator(selector).first().evaluate(element => getComputedStyle(element).backgroundColor);

  test('Radix dialog (auth), dropdown menus, drawer and the Discovery search portal are dark', async ({ page }) => {
    await installDarkModeApi(page);
    await page.addInitScript(key => localStorage.setItem(key, 'dark'), KEY);
    await page.goto('/');
    await page.getByRole('banner').getByRole('button', { name: 'Account' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(23, 34, 56)');
    expect(await lightSurfaces(page)).toEqual([]);
    expect((await newDarkContrastViolations(page)).added).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('banner').getByRole('button', { name: 'Search' }).click();
    await page.keyboard.type('mac');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await lightSurfaces(page)).toEqual([]);
  });

  test('admin alerts and profile menus, confirmation dialog and mobile drawer are dark', async ({ page }) => {
    await open(page, '/admin', 'dark');
    await page.getByRole('button', { name: /^Alerts/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await lightSurfaces(page)).toEqual([]);
    expect((await newDarkContrastViolations(page)).added).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();
    expect(await lightSurfaces(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('#admin-drawer')).toBeVisible();
    expect(await lightSurfaces(page)).toEqual([]);
  });

  test('Leaflet controls, popups and attribution follow the theme over the real leaflet.css', async ({ page }) => {
    await open(page, '/about', 'dark');
    await page.addStyleTag({ path: LEAFLET_CSS });
    await page.evaluate(() => {
      const map = document.createElement('div');
      map.className = 'leaflet-container';
      map.style.cssText = 'position:fixed;inset:20px;z-index:9999;width:400px;height:300px';
      map.innerHTML = `<div class="leaflet-control-container"><div class="leaflet-top leaflet-left"><div class="leaflet-bar leaflet-control">
        <a href="#" class="leaflet-control-zoom-in">+</a><a href="#" class="leaflet-control-zoom-out">−</a></div></div>
        <div class="leaflet-bottom leaflet-right"><div class="leaflet-control-attribution leaflet-control">© <a href="#">OpenStreetMap</a> contributors</div></div></div>
        <div class="leaflet-popup"><div class="leaflet-popup-content-wrapper"><div class="leaflet-popup-content">Courier</div></div></div>`;
      document.body.append(map);
    });
    expect(await background(page, '.leaflet-bar a')).toBe('rgb(23, 34, 56)');
    expect(await background(page, '.leaflet-popup-content-wrapper')).toBe('rgb(23, 34, 56)');
    expect(await page.locator('.leaflet-control-attribution').evaluate(element => getComputedStyle(element).color)).toBe('rgb(168, 181, 201)');
    const violations = (await contrastViolations(page)).filter(item => item.includes('leaflet'));
    expect(violations).toEqual([]);
  });
});

// ─── Route coverage sweep ────────────────────────────────────────────────────────────────────────

test.describe('route coverage — every customer and admin route themed', () => {
  for (const route of [...CUSTOMER_ROUTES, ...ADMIN_ROUTES, ...PUBLIC_ADMIN_ROUTES]) {
    test(`dark ${route}: no light surfaces, AA text contrast, no overflow, no console errors`, async ({ page }, info) => {
      const errors = trackConsoleErrors(page);
      await open(page, route, 'dark');
      await settle(page);
      expect(await appliedTheme(page)).toBe('dark');
      expect(await lightSurfaces(page), 'surfaces that stayed light').toEqual([]);
      const contrast = await newDarkContrastViolations(page);
      expect(contrast.added, 'axe color-contrast (WCAG 2.1 AA) violations introduced by dark mode').toEqual([]);
      if (contrast.preExisting.length) info.annotations.push({ type: 'pre-existing contrast (identical in light mode)', description: contrast.preExisting.join('\n') });
      expect(await noHorizontalOverflow(page)).toBe(true);
      expect(errors).toEqual([]);
      if (CAPTURE && info.project.name === 'chromium') {
        const name = route.replace(/[/?=]/g, '_');
        await page.screenshot({ path: path.join(captures, `dark${name}.png`), fullPage: true });
        await page.evaluate(key => localStorage.setItem(key, 'light'), keyForRoute(route));
        await page.reload(); await page.waitForLoadState('networkidle'); await settle(page);
        await page.screenshot({ path: path.join(captures, `light${name}.png`), fullPage: true });
      }
    });
  }
});
