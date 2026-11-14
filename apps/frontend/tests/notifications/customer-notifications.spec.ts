import { expect, test, type Page } from '@playwright/test';

// Controlled browser permission/subscription fixture; this does NOT claim real OS push presentation.
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'push@example.invalid', firstName: 'Riley', lastName: 'Fixture', role: 'CUSTOMER' };
type Permission = 'default' | 'granted' | 'denied';
const CONSENT = JSON.stringify({ version: 1, analytics: false, savedAt: Date.now() });

/** Every API is intercepted. `server.available` is what the backend reports; `permissionRequests()` counts browser prompts. */
async function account(page: Page, width: number, options: { available?: boolean; permission?: Permission } = {}) {
  const server = { available: options.available ?? true, enabled: false, statusReads: 0 };
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(([value, initialPermission, consent]) => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value));
    // An already-answered cookie choice (optional cookies rejected) so the banner does not cover the card in the evidence screenshots.
    localStorage.setItem('electrohub.privacy.v1', consent);
    let registered = false; let subscription: object | null = null;
    const registration = { active: { scriptURL: location.origin + '/delivery-push-sw.js', postMessage() {} }, pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => {
        subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/wp/browser-fixture', keys: { p256dh: 'fixture', auth: 'fixture' } }),
          unsubscribe: async () => { subscription = null; return true; } };
        return subscription;
      },
    } };
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
    const state = window as unknown as { __permissionRequests: number };
    state.__permissionRequests = 0;
    const notifications = { permission: initialPermission, requestPermission: async () => {
      state.__permissionRequests += 1;
      if (notifications.permission === 'default') notifications.permission = 'granted';
      return notifications.permission;
    } };
    Object.defineProperty(window, 'Notification', { value: notifications, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => registered ? registration : undefined,
      register: async () => { registered = true; return registration; }, ready: Promise.resolve(registration) }, configurable: true });
  }, [user, options.permission ?? 'default', CONSENT] as const);
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname; const send = (json: unknown) => route.fulfill({ json });
    if (path === '/api/auth/customer/push') {
      if (route.request().method() === 'POST') { server.enabled = true; return send({ data: { id: '11111111-1111-4111-8111-111111111111' } }); }
      server.statusReads += 1;
      return send({ data: { available: server.available, publicKey: server.available ? 'B' + 'A'.repeat(86) : null, enabled: server.enabled } });
    }
    if (path.startsWith('/api/auth/customer/push/')) { server.enabled = false; return route.fulfill({ status: 204 }); }
    if (path.startsWith('/api/auth/')) return send({ user, accessToken: 'synthetic-browser-token' });
    if (path === '/api/cart') return send({ data: { revision: 'a'.repeat(64), items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === '/api/store/profile') return send({ data: { storeName: 'ElectroHub', currency: 'USD' } });
    return send({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  });
  // A stalled page is reported with the requests still in flight, so a fixture gap is not mistaken for a broken card.
  const pending = new Set<string>();
  const label = (url: string) => { const parsed = new URL(url); return parsed.pathname + parsed.search; };
  page.on('request', request => pending.add(`${request.method()} ${label(request.url())}`));
  for (const event of ['requestfinished', 'requestfailed'] as const) page.on(event, request => pending.delete(`${request.method()} ${label(request.url())}`));
  const stalled = (error: unknown) => { throw new Error(`${(error as Error).message}
Pending at failure: ${[...pending].join(', ') || 'none'}`); };
  await page.goto('/account', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(stalled);
  const section = page.getByRole('region', { name: 'Delivery Notifications' });
  // First paint follows session restore and the lazy Account chunk.
  await expect(section).toBeVisible({ timeout: 20_000 }).catch(stalled);
  return { server, section, permissionRequests: () => page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests) };
}

/** The card stays inside the viewport and nothing in it scrolls sideways. */
async function expectFits(page: Page, section: ReturnType<Page['getByRole']>, width: number) {
  const box = (await section.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
async function capture(page: Page, section: ReturnType<Page['getByRole']>, name: string, outputPath: (file: string) => string) {
  await section.screenshot({ path: outputPath(`${name}.png`) });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await section.screenshot({ path: outputPath(`${name}-dark.png`) });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
}

for (const width of [390, 1440]) {
  test(`delivery preferences: enable from the keyboard and turn off at ${width}px`, async ({ page }, info) => {
    const { section, permissionRequests } = await account(page, width);
    await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0); // the header bell stays removed
    const enable = section.getByRole('button', { name: 'Enable delivery notifications' });
    await expect(enable).toBeEnabled();
    await expect(section.getByText('Available', { exact: true })).toBeVisible();
    expect(await permissionRequests()).toBe(0); // loading the page never opens the browser prompt
    await expectFits(page, section, width);
    await capture(page, section, `push-preferences-available-${width}`, file => info.outputPath(file));

    await enable.focus();
    await page.keyboard.press('Enter');
    await expect(section.getByText('Notifications are on for this browser.', { exact: true })).toBeVisible();
    await expect(section.getByText('On', { exact: true })).toBeVisible();
    expect(await permissionRequests()).toBe(1);
    await capture(page, section, `push-preferences-on-${width}`, file => info.outputPath(file));

    await section.getByRole('button', { name: 'Turn off notifications' }).click();
    await expect(enable).toBeEnabled();
    await expectFits(page, section, width);
  });

  test(`delivery preferences: backend reports push unavailable at ${width}px`, async ({ page }, info) => {
    const { server, section, permissionRequests } = await account(page, width, { available: false });
    const enable = section.getByRole('button', { name: 'Enable delivery notifications' });
    await expect(section.getByText('Browser alerts are not available right now.')).toBeVisible();
    await expect(section.getByText('Unavailable', { exact: true })).toBeVisible();
    await expect(enable).toBeDisabled();
    await expectFits(page, section, width);
    await capture(page, section, `push-preferences-unavailable-${width}`, file => info.outputPath(file));

    const before = server.statusReads;
    await section.getByRole('button', { name: 'Check again' }).click();
    await expect(section.getByText('Checked just now: browser alerts are still unavailable.')).toBeVisible();
    expect(server.statusReads).toBeGreaterThan(before);
    await expect(enable).toBeDisabled();

    server.available = true; // the operator enabled push: the next check turns the control on, still without a prompt
    await section.getByRole('button', { name: 'Check again' }).click();
    await expect(enable).toBeEnabled();
    await expect(section.getByRole('button', { name: 'Check again' })).toHaveCount(0);
    expect(await permissionRequests()).toBe(0);
  });
}

test('delivery preferences: a browser-level block is explained and never re-prompts on load', async ({ page }, info) => {
  const { section, permissionRequests } = await account(page, 1440, { permission: 'denied' });
  await expect(section.getByText('This browser is blocking notifications for ElectroHub.')).toBeVisible();
  await expect(section.getByText('Blocked in browser', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Check again' })).toBeEnabled();
  expect(await permissionRequests()).toBe(0);
  await capture(page, section, 'push-preferences-blocked-1440', file => info.outputPath(file));
});
