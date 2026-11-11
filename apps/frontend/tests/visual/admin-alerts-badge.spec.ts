import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './axe-audit.helper';

/** Models the server: live operational counts + this administrator's persisted baseline. Every API is intercepted; nothing real is touched. */
async function fakeAdmin(page: Page, initial = { lowStock: 2, outOfStock: 1, awaitingFulfillment: 3 }, options: { failAck?: () => boolean } = {}) {
  const live = { ...initial, preparing: 0, outForDelivery: 0 };
  const baseline = { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0 };
  const acks: unknown[] = [];
  const snapshot = () => {
    const unread = { lowStock: Math.max(0, live.lowStock - baseline.lowStock), outOfStock: Math.max(0, live.outOfStock - baseline.outOfStock),
      awaitingFulfillment: Math.max(0, live.awaitingFulfillment - baseline.awaitingFulfillment), total: 0 };
    unread.total = unread.lowStock + unread.outOfStock + unread.awaitingFulfillment;
    return { data: { ...live, unread, generatedAt: new Date().toISOString() } };
  };
  await page.route('**/api/auth/admin/refresh', route => route.fulfill({ json: { accessToken: 'visual-admin-token' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'admin-1', email: 'admin@electrohub.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } } }));
  await page.route(/^https?:\/\/[^/]+\/api\/admin\//, route => route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } }));
  await page.route('**/api/admin/dashboard/alerts', route => route.fulfill({ json: snapshot() }));
  await page.route('**/api/admin/dashboard/alerts/acknowledge', async route => {
    acks.push(route.request().postDataJSON());
    if (options.failAck?.()) return route.fulfill({ status: 503, json: { error: { code: 'X', message: 'down' } } });
    const seen = route.request().postDataJSON() as typeof baseline;
    for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) baseline[key] = Math.max(baseline[key], Math.min(seen[key], live[key]));
    return route.fulfill({ json: snapshot() });
  });
  return { live, acks };
}
const bell = (page: Page) => page.getByRole('button', { name: /^Alerts:/, includeHidden: true });

test('unread badge clears when the alerts are opened, survives refresh and navigation, and rises for a new alert', async ({ page }) => {
  const { live, acks } = await fakeAdmin(page);
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 6 unread');
  await expect(bell(page)).toContainText('6');
  await page.screenshot({ path: 'test-results/motion-contact/alerts-unread.png' });

  await bell(page).click();
  await expect(page.getByText('Operational alerts')).toBeVisible();
  await expect(page.getByText(/2 new/)).toBeVisible();          // this session's markers
  await expect(page.getByRole('menuitem', { name: /Low stock/ })).toBeVisible();      // read history stays
  await expect.poll(() => acks.length).toBe(1);
  await expect(bell(page)).toHaveAttribute('aria-label', /Alerts: no unread, 6 items need attention/);
  await expect(bell(page)).not.toContainText('6');
  await expectNoAxeViolations(page, 'alerts-menu-open');
  expect(acks[0]).toEqual({ lowStock: 2, outOfStock: 1, awaitingFulfillment: 3 });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/motion-contact/alerts-read.png' });

  await page.reload({ waitUntil: 'domcontentloaded' });         // refresh: the server's persisted baseline decides
  await expect(bell(page)).toHaveAttribute('aria-label', /no unread/);
  await page.goto('/admin/orders', { waitUntil: 'domcontentloaded' });
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await expect(bell(page)).toHaveAttribute('aria-label', /no unread/);

  live.awaitingFulfillment = 5;                                  // two new paid orders
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 2 unread');
});

test('a failed acknowledgement keeps the alerts unread and says so', async ({ page }) => {
  await fakeAdmin(page, { lowStock: 1, outOfStock: 0, awaitingFulfillment: 0 }, { failAck: () => true });
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await bell(page).click();
  await expect(page.getByRole('alert')).toContainText('could not be marked as read');
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 1 unread');
});

test('with nothing unread, opening the alerts sends no acknowledgement', async ({ page }) => {
  const { acks } = await fakeAdmin(page, { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0 });
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await bell(page).click();
  await expect(page.getByText('Operational alerts')).toBeVisible();
  expect(acks).toEqual([]);
});

test('See all alerts opens the dashboard, clears unread, and leaves the operational counts in place', async ({ page }) => {
  const { acks } = await fakeAdmin(page, { lowStock: 2, outOfStock: 1, awaitingFulfillment: 1 });
  await page.goto('/admin/inventory', { waitUntil: 'domcontentloaded' });
  await expect(bell(page)).toHaveAttribute('aria-label', 'Alerts: 4 unread');
  await bell(page).click();
  await page.getByRole('menuitem', { name: 'See all alerts' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect.poll(() => acks.length).toBe(1);
  await expect(bell(page)).toHaveAttribute('aria-label', /no unread, 4 items need attention/);
  await expect(bell(page)).not.toContainText('4');
});
