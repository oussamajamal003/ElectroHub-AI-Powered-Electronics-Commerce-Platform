import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDarkModeApi } from './darkMode.fixtures';
import { expectNoAxeViolations } from './axe-audit.helper';

/**
 * Task 06.2 (PR #51 follow-up) — admin profile shell, neutral avatars, profile photo UX, account pages, Cookie Policy, footer
 * Cookie Settings, Contact reload and placeholders. Every /api call is answered in the browser (darkMode.fixtures), and profile
 * photo upload/remove are mocked here: nothing touches a shared database, private storage, a real account or email delivery.
 *
 *   npx playwright test -c playwright.task06-2-account-privacy.config.ts
 *   ACCOUNT_PRIVACY_EVIDENCE=1 …   also copies the key screenshots into docs/tasks/Phase-06/evidence/task06.2-account-privacy/
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(here, '../../../../docs/tasks/Phase-06/evidence/task06.2-account-privacy');
const WIDTHS = [320, 390, 768, 1024, 1440, 1920] as const;
const SCHEMES = ['light', 'dark'] as const;
const PHOTO_URL = 'https://private-storage.qa.example/profile-photo.svg?token=signed';
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#94a3b8"/><stop offset="1" stop-color="#475569"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="80" cy="64" r="30" fill="#e2e8f0"/><path d="M28 160c6-34 28-52 52-52s46 18 52 52z" fill="#e2e8f0"/></svg>`;

async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: 'disabled' });
  if (process.env.ACCOUNT_PRIVACY_EVIDENCE === '1') {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    copyFileSync(file, path.join(EVIDENCE_DIR, `${name}-${info.project.name}.png`));
  }
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Mocks this user's profile photo endpoint: GET returns the current state, POST stores a photo, DELETE removes it. */
async function mockProfilePhoto(page: Page, scope: 'admin' | 'customer', initial: string | null) {
  let url = initial;
  const endpoint = scope === 'admin' ? '/api/admin/me/profile-photo' : '/api/account/profile-photo';
  await page.route(request => new URL(request).pathname === endpoint, async route => {
    const method = route.request().method();
    if (method === 'POST') url = PHOTO_URL;
    if (method === 'DELETE') { url = null; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { url, expiresAt: url ? '2030-01-01T00:00:00.000Z' : null } }) });
  });
  await page.route(url => url.href.startsWith('https://private-storage.qa.example/'), route =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO_SVG }));
}

const routes = [
  { path: '/admin/profile', who: 'admin', heading: 'My Profile' },
  { path: '/admin/profile/security', who: 'admin', heading: 'Security' },
  { path: '/admin/profile/sessions', who: 'admin', heading: 'Sessions and login history' },
  { path: '/admin/settings', who: 'admin', heading: 'Settings' },
  { path: '/account', who: 'customer', heading: 'My Account' },
  { path: '/account/profile', who: 'customer', heading: 'My Profile' },
  { path: '/cookie-policy', who: 'customer', heading: 'Cookie Policy' },
  { path: '/contact', who: 'customer', heading: "Let's talk" },
] as const;

test.describe('responsive matrix: 320–1920, light and dark, no horizontal page scroll', () => {
  for (const route of routes) {
    test(`${route.path}`, async ({ page }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await installDarkModeApi(page, { admin: route.who === 'admin', customer: route.who === 'customer' });
      await mockProfilePhoto(page, route.who, null);
      // Consent already given, so the banner does not cover the page under test (the banner has its own checks below).
      await page.addInitScript(() => window.localStorage.setItem('electrohub.privacy.v1', JSON.stringify({ version: 1, analytics: false, savedAt: Date.now() })));
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading }).first()).toBeVisible();
      const slug = route.path.replace(/\//g, '-').replace(/^-/, '');
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => horizontalOverflow(page), { message: `${route.path} ${width}px ${scheme}: horizontal overflow`, timeout: 5_000 }).toBeLessThanOrEqual(1);
          await shot(page, info, `${slug}-${width}-${scheme}`, width === 390 || width === 1440);
        }
      }
    });
  }
});

test.describe('A — /admin/profile shell', () => {
  test('header, sidebar, icons and neutral avatar survive reload, direct navigation and back/forward', async ({ page }, info) => {
    await installDarkModeApi(page, { admin: true });
    await mockProfilePhoto(page, 'admin', null);
    await page.goto('/admin/profile');
    const check = async (label: string) => {
      await expect(page.getByRole('heading', { level: 1, name: 'My Profile' }), label).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Sidebar' }), label).toBeVisible();
      await expect(page.getByRole('link', { name: 'ElectroHub admin — Dashboard' }), label).toBeVisible();
      const menu = page.getByRole('button', { name: /Account menu for/ });
      const box = await menu.boundingBox();
      expect(box && box.width <= 48 && box.height <= 48, `${label}: avatar trigger is header-sized, not giant`).toBe(true);
      // The fallback is one neutral surface (no brand-blue block, no stripes): every pixel row of the avatar shares one background.
      const fill = await menu.evaluate(button => {
        const fallback = button.querySelector('[class*="fallback"]') as HTMLElement | null;
        const root = button.querySelector('[class*="root"]') as HTMLElement | null;
        return { fallback: fallback ? getComputedStyle(fallback).backgroundColor : null, root: root ? getComputedStyle(root).backgroundColor : null,
          primary: getComputedStyle(document.documentElement).getPropertyValue('--eh-color-primary').trim(), position: fallback ? getComputedStyle(fallback).position : null };
      });
      expect(fill.fallback, label).toBe(fill.root);
      expect(fill.position, label).toBe('absolute');
      expect(fill.fallback, label).not.toContain('37, 99, 235');
    };
    await check('first load');
    await page.reload();
    await check('reload');
    await page.goto('/admin');
    await page.goto('/admin/profile');
    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/admin$/);
    await page.goForward({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/admin\/profile$/);
    await check('back/forward');
    await page.emulateMedia({ colorScheme: 'dark' });
    await check('dark');
    await shot(page, info, 'admin-profile-header-dark');
  });

  test('slow and failing profile API keep the shell intact', async ({ page }, info) => {
    await installDarkModeApi(page, { admin: true });
    await mockProfilePhoto(page, 'admin', null);
    let fail = true;
    await page.route(request => new URL(request).pathname === '/api/admin/me/profile', async route => {
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Unexpected error' } }) });
      await new Promise(resolve => setTimeout(resolve, 2500));
      return route.fallback();
    });
    await page.goto('/admin/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'My Profile' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
    await expect(page.getByRole('button', { name: /retry|try again/i }).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, info, 'admin-profile-api-error');
    fail = false;
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Personal details' })).toBeVisible({ timeout: 20_000 });
  });

  test('~500% browser zoom (384×184 CSS px) reflows to the compact header without horizontal scroll', async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 384, height: 184 }, deviceScaleFactor: 5 });
    const page = await context.newPage();
    await installDarkModeApi(page, { admin: true });
    await mockProfilePhoto(page, 'admin', null);
    await page.goto('/admin/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'My Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await shot(page, info, 'admin-profile-zoom-500');
    await context.close();
  });
});

test.describe('B — profile photo UX (mocked upload/remove)', () => {
  for (const scope of ['admin', 'customer'] as const) {
    test(`${scope}: menu, upload, header sync, preview dialog, remove`, async ({ page }, info) => {
      await installDarkModeApi(page, { admin: scope === 'admin', customer: scope === 'customer' });
      await mockProfilePhoto(page, scope, null);
      await page.addInitScript(() => window.localStorage.setItem('electrohub.privacy.v1', JSON.stringify({ version: 1, analytics: false, savedAt: Date.now() })));
      await page.goto(scope === 'admin' ? '/admin/profile' : '/account/profile');
      const card = page.getByRole('region', { name: 'Profile photo' });
      await expect(card).toBeVisible();
      await expect(card.getByText('JPEG, PNG or WebP · Maximum 5 MB')).toBeVisible();
      await expect(page.getByText(/No file chosen/i)).toHaveCount(0);
      expect(await card.locator('input[type="file"]').evaluateAll(inputs => inputs.every(input => input.getBoundingClientRect().width === 0))).toBe(true);

      // No photo: the avatar opens the edit menu, never an empty preview.
      await card.getByRole('button', { name: /Add a profile photo for/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Upload photo' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await shot(page, info, `${scope}-photo-menu`);
      await page.keyboard.press('Escape');

      // Upload through the custom trigger connected to the hidden input.
      const chooser = page.waitForEvent('filechooser');
      await card.getByRole('button', { name: 'Upload' }).click();
      await (await chooser).setFiles({ name: 'portrait.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
      const preview = page.getByRole('dialog', { name: 'Preview profile photo' });
      await expect(preview).toBeVisible();
      await preview.getByRole('button', { name: 'Save photo' }).click();
      await expect(card.getByRole('status')).toHaveText('Profile photo updated.');
      const headerTrigger = scope === 'admin' ? page.getByRole('button', { name: /Account menu for/ }) : page.getByRole('button', { name: /Account menu for/ });
      await expect(headerTrigger.locator('img')).toHaveAttribute('src', PHOTO_URL);

      // Saved photo: avatar opens an accessible preview; Escape closes it and focus returns to the avatar. Opened from the keyboard,
      // because WebKit (like Safari) does not focus a button on mouse click, so a mouse opener has no focus to restore there.
      const avatar = card.getByRole('button', { name: /View .*profile photo/ });
      await avatar.focus();
      await page.keyboard.press('Enter');
      const viewer = page.getByRole('dialog', { name: 'Profile photo' });
      await expect(viewer.getByRole('img', { name: /profile photo/ })).toBeVisible();
      await shot(page, info, `${scope}-photo-preview`);
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
      await expect(avatar).toBeFocused();
      await shot(page, info, `${scope}-photo-identity-card`);
      await page.reload();
      await expect(headerTrigger.locator('img')).toHaveAttribute('src', PHOTO_URL);
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await avatar.click();
          await expect(viewer).toBeVisible();
          await expectNoAxeViolations(page, `${scope}-photo-viewer-${scheme}-${width}`);
          await shot(page, info, `${scope}-photo-viewer-${scheme}-${width}`);
          await page.keyboard.press('Escape');
          await expect(viewer).toHaveCount(0);
        }
      }

      await card.getByRole('button', { name: 'Remove' }).click();
      await expect(card.getByRole('status')).toHaveText('Profile photo removed.');
      await expect(card.getByRole('button', { name: /Add a profile photo for/ })).toBeVisible();
      // Feedback does not persist after navigation.
      await page.goto(scope === 'admin' ? '/admin' : '/account');
      await page.goBack();
      await expect(page.getByRole('region', { name: 'Profile photo' }).getByRole('status')).toHaveText('');
    });
  }

  test('broken or expired signed URL falls back to initials and never shows a broken image', async ({ page }) => {
    await installDarkModeApi(page, { customer: true });
    await mockProfilePhoto(page, 'customer', 'https://private-storage.qa.example/expired.png');
    await page.route(url => url.pathname === '/expired.png', route => route.fulfill({ status: 403, body: 'expired' }));
    await page.goto('/account/profile');
    const card = page.getByRole('region', { name: 'Profile photo' });
    await expect(card.getByText(/Your saved photo could not be loaded/)).toBeVisible();
    await expect(card.locator('img')).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Change .*profile photo/ })).toBeVisible();
  });
});

test.describe('D/E — Cookie Policy and Cookie Settings', () => {
  test('footer Cookie Settings looks like its sibling links, opens the dialog with the current choice', async ({ page }, info) => {
    await installDarkModeApi(page, { customer: true });
    await page.goto('/cookie-policy');
    const banner = page.getByRole('region', { name: 'Cookie preferences' });
    const accept = await banner.getByRole('button', { name: 'Accept all' }).evaluate(el => getComputedStyle(el).backgroundColor);
    const reject = await banner.getByRole('button', { name: 'Reject optional' }).evaluate(el => getComputedStyle(el).backgroundColor);
    expect(reject, 'Accept is not more prominent than Reject').toBe(accept);
    await shot(page, info, 'cookie-banner');
    await banner.getByRole('button', { name: 'Reject optional' }).click();

    const footer = page.getByRole('contentinfo');
    const button = footer.getByRole('button', { name: 'Cookie Settings' });
    const link = footer.getByRole('link', { name: 'Cookie Policy' });
    const style = (el: Element) => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.lineHeight, s.color, s.fontFamily].join('|'); };
    expect(await button.evaluate(style)).toBe(await link.evaluate(style));
    await button.scrollIntoViewIfNeeded();
    await shot(page, info, 'footer-cookie-settings');
    // Keyboard open: WebKit does not focus a button on mouse click (see the profile photo test), and focus return matters to keyboard users.
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Cookie Settings' });
    await expect(dialog.getByText('Current choice:')).toBeVisible();
    await expect(dialog.getByText('Optional analytics rejected')).toBeVisible();
    await shot(page, info, 'cookie-settings-dialog');
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  });

  test('policy page: hero, contents anchors below the sticky header, reopen settings, axe light and dark', async ({ page }, info) => {
    await installDarkModeApi(page, { customer: true });
    await page.addInitScript(() => window.localStorage.setItem('electrohub.privacy.v1', JSON.stringify({ version: 1, analytics: true, savedAt: Date.now() })));
    await page.goto('/cookie-policy');
    await expect(page.getByRole('heading', { level: 1, name: 'Cookie Policy' })).toBeVisible();
    const toc = page.getByRole('navigation', { name: 'On this page' });
    await toc.getByRole('link', { name: 'Retention and earlier data' }).click();
    await expect(page).toHaveURL(/#retention$/);
    await page.waitForTimeout(600);
    const headingTop = await page.getByRole('heading', { level: 2, name: 'Retention and earlier data' }).evaluate(el => el.getBoundingClientRect().top);
    const headerBottom = await page.locator('header').first().evaluate(el => el.getBoundingClientRect().bottom);
    expect(headingTop, 'anchored heading is not hidden under the sticky header').toBeGreaterThan(headerBottom);
    await page.getByRole('button', { name: 'Manage preferences' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cookie Settings' });
    await expect(dialog.getByText('Optional analytics allowed')).toBeVisible();
    await page.keyboard.press('Escape');
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto('/cookie-policy');
      await expect(page.getByRole('heading', { level: 1, name: 'Cookie Policy' })).toBeVisible();
      await shot(page, info, `cookie-policy-${scheme}`, true);
      await expectNoAxeViolations(page, `cookie policy ${scheme}`, 'main');
    }
  });
});

test.describe('F/G — Contact reload and placeholders', () => {
  test('content already on screen is never painted visible and then hidden on reload; placeholders are examples only', async ({ page, browserName }, info) => {
    await installDarkModeApi(page, { customer: true });
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __revealLog: string[] }).__revealLog = log;
      const start = performance.now();
      const tick = () => {
        const reveal = document.querySelector('h1')?.closest('[class*="reveal"]');
        if (reveal) {
          const state = Number(getComputedStyle(reveal).opacity) < 0.05 ? 'hidden' : 'shown';
          if (log[log.length - 1] !== state) log.push(state);
        }
        if (performance.now() - start < 20_000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto('/contact', { waitUntil: 'load' });
    const placeholders = { Name: 'Enter your full name', Email: 'you@example.com', Subject: 'How can we help you?',
      Message: 'Tell us how we can help. Include your order number if relevant.' };
    for (const [field, text] of Object.entries(placeholders)) {
      await expect(page.locator(`#contact-${field}`)).toHaveAttribute('placeholder', text);
      await expect(page.locator(`#contact-${field}`)).toHaveValue('');
    }
    await page.locator('#contact-Message').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1, name: "Let's talk" })).toBeAttached();
    await expect(page.locator('#contact-Message')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('heading', { level: 1, name: "Let's talk" })).toBeVisible();
    // After the reload the h1 section either starts its entrance (hidden → shown) or is settled; "shown → hidden" is the old flash.
    const log = await page.evaluate(() => (window as unknown as { __revealLog: string[] }).__revealLog.join(' → '));
    expect(log, `${browserName} reveal sequence`).not.toMatch(/shown → hidden/);
    await shot(page, info, 'contact-after-reload');
  });

  test('profile API failure and reduced motion still render the form', async ({ page }) => {
    await installDarkModeApi(page, { customer: true });
    await page.route(request => new URL(request).pathname === '/api/store/profile', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"Unexpected"}}' }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/contact');
    await expect(page.getByRole('heading', { level: 1, name: "Let's talk" })).toBeVisible();
    await expect(page.locator('#contact-Message')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Message' })).toBeVisible();
  });

  test('admin Store settings shows the contact placeholders as examples, not values', async ({ page }, info) => {
    await installDarkModeApi(page, { admin: true });
    await page.goto('/admin/settings?tab=store');
    const expected: Record<string, string> = { 'Store email': 'support@example.com', Phone: '+961 XX XXX XXX', 'Address line 1': 'Street and building',
      'Address line 2': 'Apartment, floor or additional details (optional)', City: 'Enter city', 'State or region': 'Enter region',
      'Postal code': 'Enter postal code', Country: 'Enter country', 'Business hours': 'Monday–Friday, 9:00 AM–6:00 PM' };
    for (const [label, placeholder] of Object.entries(expected)) await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('placeholder', placeholder);
    await shot(page, info, 'admin-settings-store-placeholders', true);
  });
});

test.describe('accessibility (axe WCAG 2.1 AA)', () => {
  for (const route of routes.filter(item => item.path !== '/cookie-policy')) {
    test(`${route.path}`, async ({ page }) => {
      await installDarkModeApi(page, { admin: route.who === 'admin', customer: route.who === 'customer' });
      await mockProfilePhoto(page, route.who, null);
      await page.addInitScript(() => window.localStorage.setItem('electrohub.privacy.v1', JSON.stringify({ version: 1, analytics: false, savedAt: Date.now() })));
      for (const scheme of SCHEMES) {
        // The scheme is set before navigation so axe never samples a page mid theme transition.
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.goto(route.path);
        await expect(page.getByRole('heading', { level: 1, name: route.heading }).first()).toBeVisible({ timeout: 30_000 });
        await expectNoAxeViolations(page, `${route.path} ${scheme}`, 'main');
      }
    });
  }
});
