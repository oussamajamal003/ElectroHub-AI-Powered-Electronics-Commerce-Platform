import { expect, test } from '@playwright/test';
import { orderDetails } from '../../src/features/orders/fixtures';
// Browser presentation/interaction evidence uses controlled API fixtures. Real PostgreSQL + sockets are tested separately.
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'notifications@example.invalid', firstName: 'Riley', lastName: 'Fixture', role: 'CUSTOMER' };
const reference = orderDetails().orderReference;
for (const width of [390, 1440]) test(`notification history, read persistence, keyboard and layout at ${width}px`, async ({ page }, info) => {
  let read = false;
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(value => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)), user);
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (path.startsWith('/api/auth/')) return path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'synthetic-browser-token', user });
    if (path.endsWith('/read')) { read = true; return route.fulfill({ status: 204 }); }
    if (path === '/api/notifications') return send({ data: { items: [{ id: '11111111-1111-4111-8111-111111111111', type: 'ORDER_OUT_FOR_DELIVERY',
      orderReference: reference, occurredAt: '2026-11-11T12:00:00.000Z', readAt: read ? '2026-11-11T13:00:00.000Z' : null }], unreadCount: read ? 0 : 1, nextBefore: null } });
    if (path === '/api/cart') return send({ data: { revision: 'a'.repeat(64), items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === `/api/orders/${reference}`) return send({ data: orderDetails() });
    if (path === '/api/store/profile') return send({ data: { storeName: 'ElectroHub', supportEmail: null, supportPhone: null, currency: 'USD' } });
    return send({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  });
  await page.goto(`/orders/${reference}`);
  // Wait for the existing order-page focus handoff before testing keyboard entry.
  await expect(page.getByRole('heading', { level: 1, name: reference })).toBeFocused();
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible(); await bell.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu'); await expect(menu).toBeVisible();
  await expect(menu).toContainText(`Your order ${reference} is out for delivery.`);
  await expect(menu.getByRole('menuitem', { name: /Your order/ })).toHaveAttribute('href', `/orders/${reference}/tracking`);
  const box = await menu.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`notifications-${width}.png`), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: info.outputPath(`notifications-dark-${width}.png`), fullPage: true });
  await expect(menu).toHaveCSS('background-color', 'rgb(15, 23, 42)');
  await expect(menu.getByText(`Your order ${reference} is out for delivery.`, { exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await menu.getByRole('menuitem', { name: 'Mark as read' }).click(); await expect(menu).toContainText('Read');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeFocused();
  await page.reload(); await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications, 0 unread' }).click();
  await expect(page.getByRole('menuitem', { name: 'Mark as read' })).toHaveCount(0);
  await expect(page.getByRole('menu')).not.toContainText('shipped');
});
