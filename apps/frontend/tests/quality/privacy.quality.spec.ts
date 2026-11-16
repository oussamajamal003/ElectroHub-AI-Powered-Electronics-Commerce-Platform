import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type axe from 'axe-core';
import { distinctClientAddress, expectNoHorizontalOverflow, expectUsableControl } from '../release/support';

/**
 * Task 06.2 cookie consent quality: axe (WCAG 2.0/2.1 A and AA) on the banner, the Cookie Settings dialog and the Cookie Policy
 * under light and emulated dark colour schemes, keyboard operation and focus restoration, reduced motion, a viewport/height matrix,
 * and genuine Chromium 200% browser zoom. Real stack (Vite → Express NODE_ENV=test → disposable PostgreSQL).
 */
const require = createRequire(import.meta.url);
const banner = (page: Page) => page.getByRole('region', { name: 'Cookie preferences' });
const settings = (page: Page) => page.getByRole('dialog', { name: 'Cookie Settings' });

/** `scope`: a CSS selector to audit only that region (the home page itself is audited by accessibility.quality.spec.ts). */
async function audit(page: Page, info: TestInfo, label: string, scope?: string) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation =>
    animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
  if (await settings(page).count()) await expect(settings(page)).toHaveCSS('opacity', '1');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async selector => {
    const engine = (window as unknown as { axe: typeof axe }).axe;
    const context = (selector ? document.querySelector(selector) : null) ?? document.querySelector('[role="dialog"]') ?? document;
    return engine.run(context, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
  }, scope);
  await info.attach(`${label}-axe.json`, { body: JSON.stringify(result), contentType: 'application/json' });
  expect.soft(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), label).toEqual([]);
}
/** The focused element shows a visible indicator (outline or box-shadow ring). */
async function expectVisibleFocus(control: Locator, label: string) {
  await expect(control, label).toBeFocused();
  const ring = await control.evaluate(el => { const style = getComputedStyle(el);
    return { outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== 'none' }; });
  expect(ring.outline || ring.shadow, `${label} has a visible focus indicator`).toBe(true);
}
async function tabUntil(page: Page, target: Locator, limit = 120) {
  for (let index = 0; index < limit; index++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target never received keyboard focus');
}

test.beforeEach(async ({ page }, info) => { await distinctClientAddress(page, info); });

test('@responsive banner, settings dialog and Cookie Policy pass axe under light and emulated dark schemes', async ({ page }, info) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    // The storefront has no dark theme; an emulated dark preference must not produce a partially dark (unreadable) banner.
    const colours = await banner(page).evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    info.annotations.push({ type: `banner-colours-${scheme}`, description: JSON.stringify(colours) });
    await audit(page, info, `banner-${scheme}`, 'section[aria-label="Cookie preferences"]');
    await info.attach(`banner-${scheme}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await banner(page).getByRole('button', { name: 'Customize' }).click();
    await expect(settings(page)).toBeVisible();
    await audit(page, info, `settings-${scheme}`);
    await info.attach(`settings-${scheme}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await page.goto('/cookie-policy');
    await expect(page.getByRole('heading', { level: 1, name: 'Cookie Policy' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Retention and earlier data' })).toBeVisible();
    await audit(page, info, `policy-${scheme}`);
    await expectNoHorizontalOverflow(page, `policy-${scheme}`);
  }
});

test('@responsive keyboard: equal choices reachable, dialog keeps focus, Escape restores it, choice made without a pointer', async ({ page }) => {
  await page.goto('/');
  const accept = banner(page).getByRole('button', { name: 'Accept all' });
  const reject = banner(page).getByRole('button', { name: 'Reject optional' });
  const customize = banner(page).getByRole('button', { name: 'Customize' });
  await tabUntil(page, accept);
  await expectVisibleFocus(accept, 'Accept all');
  await page.keyboard.press('Tab');
  await expectVisibleFocus(reject, 'Reject optional');
  await page.keyboard.press('Tab');
  await expectVisibleFocus(customize, 'Customize');
  for (const [control, label] of [[accept, 'Accept all'], [reject, 'Reject optional'], [customize, 'Customize']] as const) await expectUsableControl(control, label);

  await page.keyboard.press('Enter');
  const dialog = settings(page);
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press(index < 8 ? 'Tab' : 'Shift+Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus stays inside Cookie Settings').toBe(true);
  }
  const analytics = dialog.getByRole('checkbox', { name: 'Analytics' });
  await expect(analytics).not.toBeChecked(); // nothing pre-ticked
  await expectUsableControl(dialog.locator('label').filter({ has: page.getByRole('checkbox', { name: 'Analytics' }) }), 'Analytics label target');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(customize).toBeFocused(); // focus returns to the control that opened it
  await expect(banner(page)).toBeVisible(); // dismissing is not a choice

  await reject.focus();
  await page.keyboard.press('Enter');
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Cookie preferences saved.' })).toHaveCount(1);
  const footer = page.getByRole('button', { name: 'Cookie Settings' });
  await footer.focus();
  await expectVisibleFocus(footer, 'footer Cookie Settings');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await analytics.focus();
  await page.keyboard.press('Space');
  await expect(analytics).toBeChecked();
  await page.keyboard.press('Escape'); // closing without saving keeps the stored rejection
  await expect(footer).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('electrohub.privacy.v1')!).analytics)).toBe(false);
});

test('@responsive reduced motion: the settings dialog appears without a running transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await banner(page).getByRole('button', { name: 'Customize' }).click();
  await expect(settings(page)).toBeVisible();
  const running = await page.evaluate(() => document.getAnimations().filter(animation => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState === 'running' && Number(timing?.duration ?? 0) > 20;
  }).length);
  expect(running).toBe(0);
});

test('banner and settings stay usable across widths and short or landscape heights', async ({ page }, info) => {
  test.skip(!['chromium-desktop', 'firefox-desktop', 'webkit-desktop'].includes(info.project.name), 'Matrix runs once per engine.');
  const sizes = [[320, 568], [320, 800], [390, 844], [844, 390], [768, 1024], [1024, 768], [1024, 600], [1440, 900], [1440, 640], [1920, 1080]] as const;
  for (const [width, height] of sizes) {
    const label = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    const box = (await banner(page).boundingBox())!;
    expect(box.y + box.height, `${label} banner fits the viewport height`).toBeLessThanOrEqual(height + 1);
    for (const name of ['Accept all', 'Reject optional', 'Customize']) {
      const control = banner(page).getByRole('button', { name });
      await control.scrollIntoViewIfNeeded();
      await expectUsableControl(control, `${label} ${name}`);
    }
    await expectNoHorizontalOverflow(page, `${label} banner`);
    await info.attach(`banner-${label}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await banner(page).getByRole('button', { name: 'Customize' }).click();
    await expect(settings(page)).toBeVisible();
    for (const name of ['Accept all', 'Reject optional', 'Save preferences']) {
      const control = settings(page).getByRole('button', { name });
      await control.scrollIntoViewIfNeeded();
      await expectUsableControl(control, `${label} dialog ${name}`);
    }
    await expectNoHorizontalOverflow(page, `${label} dialog`);
    await info.attach(`settings-${label}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
  }
});

test('genuine Chromium 200% browser zoom keeps the cookie banner and settings usable', async ({ baseURL }, info) => {
  test.skip(info.project.name !== 'chromium-native-zoom', 'Native zoom needs an un-emulated persistent browser window.');
  test.slow();
  const extension = info.outputPath('native-zoom-extension');
  mkdirSync(extension, { recursive: true });
  writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Task 06.2 local zoom QA',
    version: '1.0', host_permissions: [`${baseURL}/*`], background: { service_worker: 'worker.js' } }));
  writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: null, baseURL,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-size=1440,1000'] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const surface = async () => Buffer.from((await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
    await distinctClientAddress(page, info);
    await page.goto('/');
    const actual = await worker.evaluate(async zoom => {
      type Tabs = { query: (query: { url: string }) => Promise<{ id: number }[]>;
        setZoom: (id: number, factor: number) => Promise<void>; getZoom: (id: number) => Promise<number> };
      const tabs = (globalThis as unknown as { chrome: { tabs: Tabs } }).chrome.tabs;
      const [tab] = await tabs.query({ url: 'http://localhost/*' });
      if (!tab) throw new Error('Local QA tab missing');
      await tabs.setZoom(tab.id, zoom);
      return tabs.getZoom(tab.id);
    }, 2);
    expect(actual).toBe(2);
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(2);
    await page.reload();
    await expect(banner(page)).toBeVisible();
    info.annotations.push({ type: 'native-zoom', description: JSON.stringify(await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio }))) });
    for (const name of ['Accept all', 'Reject optional', 'Customize']) {
      const control = banner(page).getByRole('button', { name });
      await control.scrollIntoViewIfNeeded();
      await expectUsableControl(control, `200% ${name}`);
    }
    await expectNoHorizontalOverflow(page, '200% banner');
    await info.attach('banner-native-200.png', { body: await surface(), contentType: 'image/png' });
    await banner(page).getByRole('button', { name: 'Customize' }).click();
    const save = settings(page).getByRole('button', { name: 'Save preferences' });
    await save.scrollIntoViewIfNeeded();
    await expectUsableControl(save, '200% Save preferences');
    await expectNoHorizontalOverflow(page, '200% dialog');
    await info.attach('settings-native-200.png', { body: await surface(), contentType: 'image/png' });
    await settings(page).getByRole('button', { name: 'Reject optional' }).click();
    await expect(banner(page)).toHaveCount(0);
    await page.goto('/cookie-policy');
    await expectNoHorizontalOverflow(page, '200% policy');
  } finally {
    await context.close();
  }
});
