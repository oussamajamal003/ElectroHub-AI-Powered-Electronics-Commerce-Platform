import { expect, test, type Page, type Route } from '@playwright/test';

const REF = 'ORD-1C5BB1A2-5F0E-4F7A-9D4E-2B8D1F0A9C11';
const CUSTOMER = '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33';
const ACCESS_TOKEN = 'qa-admin-access-token';
const ADMIN = { id: '8f2813b4-a388-44d3-b51e-5d4c40386677', email: 'qa.admin@example.test', role: 'ADMIN',
  firstName: 'QA', lastName: 'Administrator', emailVerified: true, isOwner: false, canManageAdmins: false };

const orderRow = { orderReference: REF, status: 'CONFIRMED', paymentState: 'PAID', total: '99.00', currency: 'USD',
  createdAt: '2026-11-01T10:00:00.000Z', deliveryMethod: 'STANDARD', itemCount: 1,
  customer: { id: CUSTOMER, name: 'QA Customer', email: 'qa.customer@example.test' }, delivery: null };
const orderDetail = { ...orderRow, updatedAt: '2026-11-01T10:01:00.000Z', subtotal: '90.00', shippingCost: '9.00', paymentMethod: 'CARD',
  estimatedDeliveryStart: '2026-11-03T10:00:00.000Z', estimatedDeliveryEnd: '2026-11-05T10:00:00.000Z',
  customer: { ...orderRow.customer, isActive: true },
  shipping: { recipient: 'QA Customer', line1: '1 Test Street', line2: null, city: 'Testville', state: null, postalCode: '00000', country: 'US', phone: '+10000000000' },
  items: [], payment: { state: 'PAID', amount: '99.00', currency: 'USD', paidAt: '2026-11-01T10:01:00.000Z', refundedAt: null, card: null },
  delivery: { availability: 'AVAILABLE', paymentEligible: true, canStart: false, allowedNextStatus: null, revision: null, trackingReference: null,
    estimatedAt: null, deliveredAt: null, isSimulated: false } };

type ApiMode = 'signed-out' | 'signed-in';
async function installApi(page: Page, mode: ApiMode) {
  let adminAuthenticated = mode === 'signed-in';
  const adminOrderRequests: Array<{ url: string; authorization: string | undefined; authorized: boolean }> = [];
  const respond = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(url => new URL(url).pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/customer/refresh') return respond(route, { error: 'Unauthenticated' }, 401);
    if (path === '/api/auth/admin/refresh') return mode === 'signed-in'
      ? respond(route, { accessToken: ACCESS_TOKEN, user: ADMIN }) : respond(route, { error: 'Unauthenticated' }, 401);
    if (path === '/api/auth/login' && request.method() === 'POST') return respond(route, {
      requiresMfa: true, mfaToken: 'restricted-qa-challenge', expiresAt: new Date(Date.now() + 60_000).toISOString(), enrollmentRequired: false,
      factors: { totp: true, passkey: false, recoveryCode: false },
    });
    if (path === '/api/auth/admin/mfa/totp/verify' && request.method() === 'POST') {
      adminAuthenticated = true;
      return respond(route, { accessToken: ACCESS_TOKEN, user: ADMIN });
    }
    if (path === '/api/admin/dashboard/alerts') return respond(route, { data: { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0,
      preparing: 0, outForDelivery: 0, generatedAt: new Date().toISOString() } });
    if (path === '/api/admin/orders' && request.method() === 'GET') {
      const authorization = request.headers().authorization;
      const authorized = adminAuthenticated && authorization === `Bearer ${ACCESS_TOKEN}`;
      adminOrderRequests.push({ url: request.url(), authorization, authorized });
      if (!authorized) return respond(route, { error: 'Forbidden' }, 403);
      const exactReference = url.searchParams.get('orderReference');
      return respond(route, { data: exactReference === REF ? [orderRow] : [], meta: { page: 1, pageSize: 20,
        total: exactReference === REF ? 1 : 0, totalPages: exactReference === REF ? 1 : 0,
        statusCounts: exactReference === REF ? { CONFIRMED: 1 } : {} } });
    }
    if (path === `/api/admin/orders/${REF}` && request.method() === 'GET') {
      const authorized = adminAuthenticated && request.headers().authorization === `Bearer ${ACCESS_TOKEN}`;
      return authorized ? respond(route, { data: orderDetail }) : respond(route, { error: 'Forbidden' }, 403);
    }
    // The page only needs alerts. Keep other optional shell requests inert in this focused browser fixture.
    return respond(route, { data: {} });
  });
  return adminOrderRequests;
}

test.describe.configure({ mode: 'serial' });

test('email deep link survives Admin Login and MFA, then opens the exact highlighted order', async ({ page }) => {
  const requests = await installApi(page, 'signed-out');
  await page.goto(`/admin/orders?focus=${REF}&q=stale-query&status=CANCELLED&payment=FAILED&page=9`);

  await expect(page.getByRole('heading', { name: 'Sign In to Admin' })).toBeVisible();
  expect(requests).toHaveLength(0); // A guest never receives order-list data before the admin MFA session exists.
  await page.getByLabel('Email Address').fill('qa.admin@example.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('fake-only-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { name: "Verify it's you" })).toBeVisible();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();

  const focusedRow = page.getByRole('row', { name: `Order ${REF}, ready to view details` });
  await expect(focusedRow).toBeVisible();
  await expect(focusedRow).toBeFocused();
  await expect(focusedRow).toHaveClass(/focusedOrderRow/);
  await expect(page.getByRole('status')).toContainText(`Order ${REF} found`);
  await expect(page).toHaveURL(new RegExp(`/admin/orders\\?q=${REF.replaceAll('-', '\\-')}&focus=${REF.replaceAll('-', '\\-')}$`));
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(item => item.authorized && new URL(item.url).searchParams.get('orderReference') === REF)).toBe(true);

  await page.getByRole('link', { name: `View details for order ${REF}` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${REF.replaceAll('-', '\\-')}$`));
  await expect(page.getByRole('heading', { level: 1, name: REF })).toBeVisible();
});

test('reduced motion, repeated deep links and narrow/zoomed layouts remain usable', async ({ page }) => {
  await installApi(page, 'signed-in');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    (window as Window & { __orderScrollBehavior?: string }).__orderScrollBehavior = '';
    HTMLElement.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions) {
      (window as Window & { __orderScrollBehavior?: string }).__orderScrollBehavior = options?.behavior ?? 'auto';
    };
  });
  const url = `/admin/orders?focus=${REF}&status=DELIVERED&payment=FAILED`;
  await page.goto(url);
  const row = page.getByRole('row', { name: `Order ${REF}, ready to view details` });
  await expect(row).toHaveClass(/focusedOrderRow/);
  await expect(row).toBeFocused();
  expect(await row.locator('td').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await page.evaluate(() => (window as Window & { __orderScrollBehavior?: string }).__orderScrollBehavior)).toBe('auto');
  expect(await row.locator('td').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(240, 249, 255)');

  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `document overflow at ${width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'document overflow at 200% zoom').toBe(true);

  await page.waitForTimeout(3100);
  await expect(row).not.toHaveClass(/focusedOrderRow/);
  await page.goto(url);
  await expect(page.getByRole('row', { name: `Order ${REF}, ready to view details` })).toHaveClass(/focusedOrderRow/);
});
