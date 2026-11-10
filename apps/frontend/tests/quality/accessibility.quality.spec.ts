import { createRequire } from 'node:module';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type axe from 'axe-core';
import { admins, distinctClientAddress, expectNoHorizontalOverflow, product, shopper, signInAdmin, signInCustomer } from '../release/support';

const require = createRequire(import.meta.url);
async function audit(page: Page, testInfo: TestInfo, label: string) {
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
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), label).toEqual([]);
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
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
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
  for (const url of ['/orders', '/account', '/account/profile']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await audit(page, info, url.slice(1));
  }
});

test('admin MFA, tables, settings and navigation semantics', async ({ page }, info) => {
  test.slow();
  await signInAdmin(page, admins(info).ownerEmail);
  for (const url of ['/admin', '/admin/products', '/admin/inventory', '/admin/orders', '/admin/deliveries', '/admin/settings']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await capture(page, info, url.replaceAll('/', '-'));
    await audit(page, info, url);
  }
});
