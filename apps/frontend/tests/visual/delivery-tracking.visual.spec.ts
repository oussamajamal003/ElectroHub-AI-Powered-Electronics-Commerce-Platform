import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 04.5 real Chromium QA against the disposable stack from apps/backend/scripts/delivery-qa-stack.cjs (React → Express → PostgreSQL with
 * fixtures written through the real DeliveryService). Covers T5-21 (390/768/1440/1920 + 200% zoom, keyboard, overflow), the Order Details
 * entry point, every 04.5 customer state, Copy, Retry, IDOR, sign-in protection and the admin Start → update → conflict → delivered workflow.
 * Only the Retry test uses a controlled network fault; everything else is a genuine API response.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const pointer = path.join(root, '.cache', 'delivery-qa-stack.current');
const state = existsSync(pointer) ? JSON.parse(readFileSync(readFileSync(pointer, 'utf8').trim(), 'utf8')) as { frontend: string; credentials: string } : null;
const fixtures = state ? JSON.parse(readFileSync(state.credentials, 'utf8')) as {
  admin: { email: string; password: string }; customer: { email: string; password: string }; other: { email: string; password: string };
  orders: Record<'notStarted' | 'adminFlow' | 'confirmedTracked' | 'preparing' | 'outFresh' | 'outStale' | 'outNoLocation' | 'delivered' | 'cancelled'
    | 'awaitingCapture' | 'legacyUnpaid' | 'otherCustomer', string> } : null;
const base = state?.frontend ?? 'http://localhost:3310';
const shots = path.resolve(here, '../../screenshots/delivery-04.5');
mkdirSync(shots, { recursive: true });

test.skip(!fixtures, 'Start apps/backend/scripts/delivery-qa-stack.cjs first (disposable QA stack).');
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, who: 'customer' | 'admin' | 'other' = 'customer') {
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: fixtures![who].email, password: fixtures![who].password } });
  expect(login.status()).toBe(200);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
async function axe(page: Page) {
  await page.addScriptTag({ content: readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
  return page.evaluate(async () => (await Reflect.get(window, 'axe').run(document.querySelector('main') ?? document,
    { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`));
}
const tracking = (reference: string) => `${base}/orders/${reference}/tracking`;
async function openTracking(page: Page, reference: string) {
  await page.goto(tracking(reference));
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`Track order ${reference}`) })).toBeVisible();
}

test('Order Details → Track delivery → tracking page → View order details → Back to Orders', async ({ page }) => {
  await signIn(page);
  await page.goto(`${base}/orders/${fixtures!.orders.outFresh}`);
  // Scoped to main: the existing customer header also has a "Track Delivery" nav link (to /orders).
  const link = page.locator('main').last().getByRole('link', { name: 'Track delivery', exact: true });
  await expect(link).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'order-details-track-action-1440.png'), fullPage: true });
  await link.click();
  await expect(page).toHaveURL(tracking(fixtures!.orders.outFresh));
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.locator('main').last().getByRole('link', { name: 'View order details', exact: true }).click();
  await expect(page).toHaveURL(`${base}/orders/${fixtures!.orders.outFresh}`);
  await page.goBack();
  await page.locator('main').last().getByRole('link', { name: 'Back to Orders', exact: true }).click();
  await expect(page).toHaveURL(`${base}/orders`);
  for (const [reference, label] of [[fixtures!.orders.delivered, 'View delivery details'], [fixtures!.orders.awaitingCapture, null],
    [fixtures!.orders.cancelled, null], [fixtures!.orders.legacyUnpaid, null]] as const) {
    await page.goto(`${base}/orders/${reference}`);
    await expect(page.getByRole('heading', { level: 1, name: /^Order ORD-/ })).toBeVisible();
    if (label) await expect(page.locator('main').last().getByRole('link', { name: label, exact: true })).toBeVisible();
    else await expect(page.locator('main').last().getByRole('link', { name: /track delivery|delivery details/i })).toHaveCount(0);
  }
});

test('every 04.5 customer state at 1440: real API, no overflow, no axe violations, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await signIn(page);
  const states: [keyof typeof fixtures.orders, string | RegExp][] = [
    ['outFresh', 'Recent · updated'], ['outStale', 'Stale · updated'], ['outNoLocation', 'No location has been shared yet'], ['preparing', 'Preparing your order'],
    ['confirmedTracked', 'Order confirmed'], ['notStarted', 'Assigned when tracking starts'], ['delivered', 'Live location is switched off after delivery'],
    ['cancelled', 'This order was cancelled'], ['awaitingCapture', 'Tracking isn’t available yet'], ['legacyUnpaid', 'Tracking isn’t available yet'],
  ];
  for (const [key, text] of states) {
    await openTracking(page, fixtures!.orders[key]);
    await expect(page.locator('main').last()).toContainText(text);
    await page.screenshot({ path: path.join(shots, `tracking-${key}-1440.png`), fullPage: true });
    await noOverflow(page);
    expect(await axe(page), key).toEqual([]);
  }
  await openTracking(page, fixtures!.orders.outNoLocation);
  await expect(page.locator('main').last()).toContainText('Not available yet');
  expect(errors).toEqual([]);
});

test('T5-21 responsive: 390 / 768 / 1920 and 200% zoom keep the order and never overflow', async ({ page }) => {
  await signIn(page);
  for (const [name, viewport] of [['390', { width: 390, height: 844 }, 1], ['768', { width: 768, height: 1024 }, 1],
    // 200% zoom of a 1280px window = a 640 CSS-px layout viewport.
    ['1920', { width: 1920, height: 1080 }, 1], ['zoom200-1280', { width: 640, height: 450 }, 2]] as const) {
    await page.setViewportSize(viewport);
    await openTracking(page, fixtures!.orders.outFresh);
    await page.screenshot({ path: path.join(shots, `tracking-outFresh-${name}.png`), fullPage: true });
    await noOverflow(page);
    const overview = await page.getByRole('region', { name: 'Delivery overview' }).boundingBox();
    const progress = await page.getByRole('region', { name: 'Delivery progress' }).boundingBox();
    if (viewport.width < 1024) expect(overview!.y).toBeLessThan(progress!.y);
    else expect(overview!.x).toBeGreaterThan(progress!.x);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const key of ['delivered', 'notStarted', 'cancelled'] as const) {
    await openTracking(page, fixtures!.orders[key]);
    await page.screenshot({ path: path.join(shots, `tracking-${key}-390.png`), fullPage: true });
    await noOverflow(page);
  }
});

test('keyboard: overview-first focus order, visible focus ring, 44px targets, aria-current, reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await openTracking(page, fixtures!.orders.outFresh);
  await expect(page.locator('[aria-current="step"]')).toContainText('Out for delivery');
  const stops: { name: string; outline: string; height: number; inMain: boolean }[] = [];
  for (let index = 0; index < 40; index++) {
    await page.keyboard.press('Tab');
    // Read after a frame: immediately after a key press Chromium can still report the pre-:focus-visible default (medium = 3px).
    const info = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return { name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 60), outline: `${style.outlineStyle} ${style.outlineWidth}`,
        height: element.getBoundingClientRect().height, inMain: Boolean(element.closest('main')) };
    });
    if (info) stops.push(info);
  }
  const main = stops.filter(stop => stop.inMain);
  const copy = main.findIndex(stop => stop.name.startsWith('Copy tracking reference'));
  const details = main.findIndex(stop => stop.name === 'View order details');
  expect(copy).toBeGreaterThanOrEqual(0);
  expect(copy).toBeLessThan(details);
  for (const stop of main) expect(stop.outline, stop.name).toMatch(/^solid 2px$/);
  // Inline-text targets are exempt (WCAG 2.5.8): breadcrumb links and the Task 04.6 map attribution (a 12px caption link per the handoff).
  for (const stop of main.filter(item => !['Home', 'Orders', '© OpenStreetMap contributors'].includes(item.name) && !item.name.startsWith('ORD-'))) {
    expect(stop.height, stop.name).toBeGreaterThanOrEqual(44);
  }
  const transition = await page.locator('button', { hasText: 'Copy' }).evaluate(element => getComputedStyle(element).transitionDuration);
  // The global reduced-motion rule clamps every transition to 0.01ms (reported as 1e-05s): effectively instant.
  expect(parseFloat(transition)).toBeLessThanOrEqual(0.001);
});

test('Copy puts the real tracking reference on the clipboard and announces it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await signIn(page);
  await openTracking(page, fixtures!.orders.outFresh);
  const reference = (await page.getByRole('region', { name: 'Delivery overview' }).locator('span[class*="mono"]').first().textContent())!.trim();
  expect(reference).toMatch(/^EH-TRK-[0-9A-Z]{10}$/);
  await page.getByRole('button', { name: `Copy tracking reference ${reference}` }).click();
  await expect(page.getByRole('button', { name: `Copy tracking reference ${reference}` })).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(reference);
  await expect(page.getByRole('status').filter({ hasText: 'Tracking reference copied.' })).toHaveCount(1);
});

test('Retry after an API failure (controlled fault), then the real snapshot loads', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/orders/*/delivery', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE","message":"x"}}' }));
  await page.goto(tracking(fixtures!.orders.preparing));
  await expect(page.getByRole('heading', { name: 'Tracking could not be loaded' })).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'tracking-error-1440.png'), fullPage: true });
  await page.unroute('**/api/orders/*/delivery');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('region', { name: 'Delivery overview' })).toContainText('Preparing your order');
});

test('T5-11 IDOR and sign-in protection', async ({ page, browser }) => {
  await signIn(page);
  await page.goto(tracking(fixtures!.orders.otherCustomer));
  await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
  await expect(page.locator('main').last()).not.toContainText('EH-TRK-');
  const guest = await browser.newPage();
  await guest.goto(tracking(fixtures!.orders.outFresh));
  await expect(guest.getByRole('heading', { name: 'Sign In Required' })).toBeVisible();
  await guest.close();
});

test('admin: list → Start → update with confirm dialog → revision conflict → delivered; customer sees history after hard refresh', async ({ page, browser }) => {
  await signIn(page, 'admin');
  await page.goto(`${base}/admin/deliveries`);
  await expect(page.getByRole('heading', { level: 1, name: 'Deliveries' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText(fixtures!.orders.adminFlow);
  await page.screenshot({ path: path.join(shots, 'admin-deliveries-1440.png'), fullPage: true });
  await page.getByRole('link', { name: `Manage delivery for ${fixtures!.orders.adminFlow}` }).click();
  await page.getByRole('button', { name: 'Start tracking' }).click();
  await expect(page.getByRole('heading', { name: 'Update delivery' })).toBeVisible();
  await expect(page.getByText('Revision 1.', { exact: false })).toBeVisible();

  // A second admin tab loads revision 1 before the first tab saves.
  const stale = await browser.newPage();
  await stale.context().addCookies(await page.context().cookies());
  await signIn(stale, 'admin');
  await stale.goto(page.url());
  await expect(stale.getByText('Revision 1.', { exact: false })).toBeVisible();

  await page.getByRole('combobox', { name: 'Next status' }).click();
  await page.getByRole('option', { name: 'Move to Preparing' }).click();
  await page.getByRole('button', { name: 'Review update' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm delivery update' });
  await expect(dialog).toContainText('Status: Confirmed → Preparing');
  await page.screenshot({ path: path.join(shots, 'admin-confirm-dialog-1440.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Review update' })).toBeFocused();
  await page.getByRole('button', { name: 'Review update' }).click();
  await page.getByRole('button', { name: 'Confirm update' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Update saved. Revision 2.' })).toBeVisible();

  await stale.getByRole('combobox', { name: 'Next status' }).click();
  await stale.getByRole('option', { name: 'Move to Preparing' }).click();
  await stale.getByRole('button', { name: 'Review update' }).click();
  await stale.getByRole('button', { name: 'Confirm update' }).click();
  await expect(stale.getByRole('alert').filter({ hasText: 'Another administrator updated this delivery' })).toBeVisible();
  await stale.screenshot({ path: path.join(shots, 'admin-conflict-1440.png'), fullPage: true });
  await stale.getByRole('button', { name: 'Load latest' }).click();
  await expect(stale.getByText('Revision 2.', { exact: false })).toBeVisible();
  await stale.close();

  await page.getByRole('combobox', { name: 'Next status' }).click();
  await page.getByRole('option', { name: 'Move to Out for delivery' }).click();
  await page.getByLabel('Latitude').fill('34.0407');
  await page.getByLabel('Longitude').fill('-118.2468');
  await page.getByLabel('Location label (optional)').fill('Arts District depot');
  await page.getByLabel('Internal note (optional)').fill('QA: van 7');
  await page.getByRole('button', { name: 'Review update' }).click();
  await page.getByRole('button', { name: 'Confirm update' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Update saved. Revision 3.' })).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'admin-detail-out-for-delivery-1440.png'), fullPage: true });
  expect(await axe(page)).toEqual([]);

  await page.getByRole('combobox', { name: 'Next status' }).click();
  await page.getByRole('option', { name: 'Move to Delivered' }).click();
  await page.getByRole('button', { name: 'Review update' }).click();
  await expect(page.getByRole('dialog')).toContainText('Delivered is final. This can’t be undone.');
  await page.getByRole('button', { name: 'Confirm update' }).click();
  await expect(page.getByText('This order has been delivered.', { exact: false })).toBeVisible();

  const customer = await browser.newPage();
  await signIn(customer);
  await customer.goto(tracking(fixtures!.orders.adminFlow));
  await customer.reload();
  const history = customer.getByRole('region', { name: 'Delivery history' });
  await expect(history.getByRole('listitem')).toHaveCount(4);
  await expect(history).toContainText('Delivered'); await expect(history).toContainText('Out for delivery');
  await expect(history).toContainText('Preparing'); await expect(history).toContainText('Tracking started');
  await expect(customer.locator('main').last()).not.toContainText('QA: van 7');
  await customer.screenshot({ path: path.join(shots, 'tracking-adminFlow-delivered-1440.png'), fullPage: true });
  await customer.close();
});
