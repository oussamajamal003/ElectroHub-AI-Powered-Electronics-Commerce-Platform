import { createRequire } from 'node:module';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type axe from 'axe-core';
import { admins, distinctClientAddress, expectNoHorizontalOverflow, product, shopper, signInAdmin, signInCustomer } from '../release/support';

const require = createRequire(import.meta.url);
async function audit(page: Page, testInfo: TestInfo, label: string) {
  // Full-page capture can reveal sections and start CSS transitions (notably in Firefox).
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation =>
    animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
  // Contrast must be sampled after the modal's entrance fade, not at a transient opacity.
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await expect(dialog).toHaveCSS('opacity', '1');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async () => {
    const engine = (window as unknown as { axe: typeof axe }).axe;
    // A modal's dimmed background is inert. Scan the active dialog here and the full page when no modal is open.
    return engine.run(document.querySelector('[role="dialog"]') ?? document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
  });
  await testInfo.attach(`${label}-axe.json`, { body: JSON.stringify(result), contentType: 'application/json' });
  // Keep auditing subsequent templates after a violation; soft assertions still fail the test and CI.
  expect.soft(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), label).toEqual([]);
}
async function capture(page: Page, info: TestInfo, label: string) {
  await expectNoHorizontalOverflow(page, label);
  await info.attach(`${label}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

test.beforeEach(async ({ page }, info) => { await distinctClientAddress(page, info); });

test('@responsive keyboard skip link, visible focus, search containment and focus restoration', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await skip.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const search = page.getByRole('button', { name: 'Search', exact: true });
  await search.focus();
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Search ElectroHub' });
  const box = dialog.getByRole('combobox', { name: 'Search products' });
  await expect(box).toBeFocused();
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press(index < 12 ? 'Tab' : 'Shift+Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await capture(page, info, 'search-keyboard');
  await audit(page, info, 'search');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(search).toBeFocused();
});

test('@responsive storefront templates, empty states and authentication semantics', async ({ page }, info) => {
  for (const [url, label] of [['/', 'home'], ['/search?q=aurora', 'search-results'],
    [`/products/${product('REL-AURORA-HP').slug}`, 'product'], ['/cart', 'empty-cart'], ['/wishlist', 'empty-wishlist']] as const) {
    await page.goto(url);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page).toHaveTitle(new RegExp('ElectroHub'));
    await capture(page, info, label);
    await audit(page, info, label);
  }
  const account = page.getByRole('button', { name: 'Account', exact: true });
  await account.focus();
  await account.press('Space');
  const dialog = page.getByRole('dialog', { name: 'Welcome Back' });
  await expect(dialog.getByRole('textbox', { name: 'Email Address' })).toBeVisible();
  await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible();
  await audit(page, info, 'login');
  await capture(page, info, 'login');
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
});

test('reduced motion keeps discovery usable without active motion', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const box = page.getByRole('combobox', { name: 'Search products' });
  await box.fill('aurora');
  await expect(page.getByRole('option', { name: /Aurora/ }).first()).toBeVisible();
  const durations = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running')
    .map(a => Number(a.effect?.getComputedTiming().duration)));
  expect(durations.filter(duration => duration > 1)).toEqual([]);
  await audit(page, info, 'reduced-motion');
});

test('authenticated orders and profile have accessible semantics', async ({ page }, info) => {
  await page.goto('/');
  await signInCustomer(page, shopper(info, 'orders').email);
  const reference = shopper(info, 'orders').orderReference;
  for (const url of ['/orders', `/orders/${reference}`, `/orders/${reference}/tracking`, '/account', '/account/profile']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await audit(page, info, url.slice(1));
  }
});

test('@responsive admin MFA, tables, settings and navigation semantics', async ({ page }, info) => {
  test.slow();
  await signInAdmin(page, admins(info).ownerEmail);
  for (const url of ['/admin', '/admin/products', '/admin/products/new', '/admin/categories', '/admin/inventory', '/admin/orders',
    '/admin/deliveries', '/admin/customers', '/admin/recommendations', '/admin/analytics', '/admin/settings',
    '/admin/settings?tab=shipping', '/admin/settings?tab=notifications',
    '/admin/settings/administrators', '/admin/profile', '/admin/profile/security', '/admin/profile/sessions']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await capture(page, info, url.replaceAll('/', '-'));
    await audit(page, info, url);
  }
});

test('product API outage terminates loading and supports recovery', async ({ page }, info) => {
  const item = product('REL-AURORA-HP');
  let unavailable = true;
  await page.route(`**/api/products/${item.slug}`, route => unavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE","message":"Temporarily unavailable"}}' })
    : route.continue());
  await page.goto(`/products/${item.slug}`);
  await expect(page.getByRole('heading', { name: 'Product unavailable' })).toBeVisible();
  await audit(page, info, 'product-outage');
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: item.name })).toBeVisible();
  await audit(page, info, 'product-recovered');
});

test('slow suggestions announce loading and settle to real results', async ({ page }, info) => {
  let release: (() => void) | undefined;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/search/suggestions?*', async route => { await responseGate; await route.continue(); });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search products' }).fill('aurora');
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Loading suggestions');
    await capture(page, info, 'slow-suggestions');
    release?.();
    await expect(page.getByRole('option', { name: /Aurora/ }).first()).toBeVisible();
    await audit(page, info, 'slow-suggestions-recovered');
  } finally { release?.(); }
});
