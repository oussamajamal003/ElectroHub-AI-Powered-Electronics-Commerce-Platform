import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './axe-audit.helper';

const CATEGORIES = ['lowStock', 'outOfStock', 'awaitingFulfillment', 'outForDelivery'] as const;
type Category = typeof CATEGORIES[number];
type Counts = Record<Category, number>;

/** Models the server: live operational counts + this administrator's persisted per-category baseline. Every API is intercepted. */
async function fakeAdmin(page: Page, initial: Counts = { lowStock: 2, outOfStock: 1, awaitingFulfillment: 3, outForDelivery: 1 },
  options: { failAck?: () => boolean } = {}) {
  const live = { ...initial, preparing: 0 };
  const baseline: Counts = { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0, outForDelivery: 0 };
  const acks: Partial<Counts>[] = [];
  const snapshot = () => {
    const unread = Object.fromEntries(CATEGORIES.map(key => [key, Math.max(0, live[key] - baseline[key])])) as Counts;
    return { data: { ...live, unread: { ...unread, total: CATEGORIES.reduce((sum, key) => sum + unread[key], 0) }, generatedAt: new Date().toISOString() } };
  };
  await page.route('**/api/auth/admin/refresh', route => route.fulfill({ json: { accessToken: 'visual-admin-token' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'admin-1', email: 'admin@electrohub.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } } }));
  await page.route(/^https?:\/\/[^/]+\/api\/admin\//, route => route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } }));
  await page.route('**/api/admin/dashboard/alerts', route => route.fulfill({ json: snapshot() }));
  await page.route('**/api/admin/dashboard/alerts/acknowledge', async route => {
    const seen = route.request().postDataJSON() as Partial<Counts>;
    acks.push(seen);
    if (options.failAck?.()) return route.fulfill({ status: 503, json: { error: { code: 'X', message: 'down' } } });
    for (const key of CATEGORIES) if (seen[key] !== undefined) baseline[key] = Math.max(Math.min(baseline[key], live[key]), Math.min(seen[key]!, live[key]));
    return route.fulfill({ json: snapshot() });
  });
  return { live, acks };
}
const bell = (page: Page) => page.getByRole('button', { name: /^Alerts:/, includeHidden: true });
const menu = (page: Page) => page.getByRole('menu');
/** Opens the alerts menu once any previous menu has finished closing (a click during the close animation would be swallowed). */
async function openAlerts(page: Page) {
  await expect(menu(page)).toHaveCount(0);
  await bell(page).click();
  await expect(menu(page)).toBeVisible();
}

test('opening the bell acknowledges nothing; each category acknowledges only itself and the state survives refresh', async ({ page }) => {
  const { live, acks } = await fakeAdmin(page);
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 7 unread', { timeout: 30_000 });
  await expect(bell(page)).toContainText('7');

  await openAlerts(page);
  await expect(menu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /See all alerts/ })).toHaveCount(0);
  await expect(menu(page).getByText('Live counts from orders and inventory. Refreshed every minute.')).toBeVisible();
  await expectNoAxeViolations(page, 'alerts-menu-open');
  await page.screenshot({ path: 'test-results/alerts/alerts-menu-open.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(acks).toEqual([]);                                                       // opening never acknowledges
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 7 unread');

  await openAlerts(page);
  await page.getByRole('menuitem', { name: /^Out for delivery/ }).click();
  await expect(page).toHaveURL(/\/admin\/deliveries\?status=OUT_FOR_DELIVERY$/);
  await expect.poll(() => acks).toEqual([{ outForDelivery: 1 }]);
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 6 unread');

  await page.reload({ waitUntil: 'domcontentloaded' });                           // the server's persisted baseline decides
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 6 unread');
  await openAlerts(page);
  await expect(page.getByRole('menuitem', { name: /^Out for delivery/ })).not.toContainText('new');
  await expect(page.getByRole('menuitem', { name: /^Low stock/ })).toContainText('· 2 new');
  await page.getByRole('menuitem', { name: /^Low stock/ }).click();
  await expect(page).toHaveURL(/\/admin\/inventory\?status=LOW_STOCK$/);
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 4 unread');
  await openAlerts(page);
  await page.getByRole('menuitem', { name: /^Out of stock/ }).click();
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 3 unread');
  await openAlerts(page);
  await page.getByRole('menuitem', { name: /^Paid orders awaiting fulfillment/ }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?status=CONFIRMED&payment=PAID$/);
  await expect(bell(page)).toHaveAttribute('aria-label', /Alerts: no unread, 7 items need attention/);
  expect(acks).toEqual([{ outForDelivery: 1 }, { lowStock: 2 }, { outOfStock: 1 }, { awaitingFulfillment: 3 }]);

  live.awaitingFulfillment = 5;                                                   // two new paid orders
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 2 unread');
});

test('a failed acknowledgement rolls the badge back and says so', async ({ page }) => {
  const { acks } = await fakeAdmin(page, { lowStock: 1, outOfStock: 1, awaitingFulfillment: 0, outForDelivery: 0 }, { failAck: () => true });
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await openAlerts(page);
  await page.getByRole('menuitem', { name: /^Low stock/ }).click();
  await expect.poll(() => acks.length).toBe(1);
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 2 unread');
  await openAlerts(page);
  await expect(page.getByRole('alert')).toContainText('could not be marked as read');
});

test('the alerts panel is 460px wide and stays inside narrow viewports', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fakeAdmin(page);
    await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
    await openAlerts(page);
    // The open animation uses perspective + rotateX, which widens the box until it settles; measure the settled menu.
    await menu(page).evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const box = (await menu(page).boundingBox())!;
    // `.alertsMenu` is a fixed 28.75rem (460px); `.menu` caps it at 100vw - 2rem, so a phone gets the viewport minus a 16px gutter each side.
    const expected = Math.min(460, width - 32);
    console.log(`alerts menu width at ${width}px viewport: ${box.width.toFixed(1)}px`);
    expect(Math.abs(box.width - expected)).toBeLessThanOrEqual(1); // WebKit sub-pixel rounding
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // The width is fixed, not content-driven: longer footer copy wraps instead of stretching the panel.
    const stretched = await menu(page).evaluate(element => {
      const foot = element.querySelector('p:last-of-type')!;
      const original = foot.textContent;
      foot.textContent = 'Live counts from orders and inventory. Reading alerts clears the unread badge; the counts clear only when the work is done.';
      const measured = element.getBoundingClientRect().width;
      foot.textContent = original;
      return measured;
    });
    expect(Math.abs(stretched - box.width)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/alerts/alerts-menu-${width}.png` });
    await page.keyboard.press('Escape');
  }
});
