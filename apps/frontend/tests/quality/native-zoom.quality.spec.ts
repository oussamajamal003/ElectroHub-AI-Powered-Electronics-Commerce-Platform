import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { admins, distinctClientAddress, expectNoHorizontalOverflow, product, signInAdmin } from '../release/support';

test('genuine Chromium 100% and 200% browser zoom preserves critical controls', async ({ baseURL }, info) => {
  test.skip(info.project.name !== 'chromium-native-zoom', 'Native zoom needs an un-emulated persistent browser window.');
  test.slow();
  const extension = info.outputPath('native-zoom-extension');
  mkdirSync(extension, { recursive: true });
  writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Task 06.2 local zoom QA',
    version: '1.0', host_permissions: [`${baseURL}/*`], background: { service_worker: 'worker.js' } }));
  writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  // Native tabs.setZoom in a real browser profile, not CSS zoom, setPageScaleFactor, deviceScaleFactor or viewport substitution.
  // No user profile or installed extension is modified. Playwright deletes this temporary profile on close.
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: null, baseURL,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-size=1440,1000'] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const surfaceScreenshot = async () => Buffer.from((await session.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    })).data, 'base64');
    await distinctClientAddress(page, info);
    await page.goto('/');
    const measurements = [];
    for (const factor of [1, 2]) {
      const actual = await worker.evaluate(async zoom => {
        type Tabs = { query: (query: { url: string }) => Promise<{ id: number }[]>;
          setZoom: (id: number, factor: number) => Promise<void>; getZoom: (id: number) => Promise<number> };
        const tabs = (globalThis as unknown as { chrome: { tabs: Tabs } }).chrome.tabs;
        const [tab] = await tabs.query({ url: 'http://localhost/*' });
        if (!tab) throw new Error('Local QA tab missing');
        await tabs.setZoom(tab.id, zoom);
        return tabs.getZoom(tab.id);
      }, factor);
      expect(actual).toBe(factor);
      await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(factor);
      const viewport = await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio }));
      measurements.push({ factor: actual, ...viewport });
      for (const url of ['/', `/products/${product('REL-AURORA-HP').slug}`, '/cart']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expectNoHorizontalOverflow(page, `${factor * 100}% ${url}`);
      }
      await page.getByRole('button', { name: 'Account', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Welcome Back' });
      await expect(dialog.getByRole('textbox', { name: 'Email Address' })).toBeVisible();
      await dialog.getByLabel('Password', { exact: true }).fill('SyntheticKeyboardQA');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await info.attach(`customer-native-${factor * 100}.png`, { body: await surfaceScreenshot(), contentType: 'image/png' });
    }
    await signInAdmin(page, admins(info).ownerEmail);
    for (const url of ['/admin', '/admin/products', '/admin/settings']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page, `200% ${url}`);
    }
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
    await info.attach('admin-native-200.png', { body: await surfaceScreenshot(), contentType: 'image/png' });
    await info.attach('native-zoom.json', { body: JSON.stringify({ method: 'chrome.tabs.setZoom + getZoom', browser: context.browser()?.version(), measurements }), contentType: 'application/json' });
  } finally { await context.close(); }
});
