import { expect, test, type Page } from '@playwright/test';
import { orderDetails, manyItemsDetails } from '../../src/features/orders/fixtures';
import type { OrderDetails } from '../../src/features/orders/types';

// Task 03.8 email-notice journeys and visual evidence. MOCKED READS: every /api call is intercepted with deterministic fixtures
// (no Brevo, no database). They prove truthful presentation, placement, responsiveness and that reads never cause writes.
const SHOTS = 'test-results/commerce-email';
const WIDTHS = [390, 768, 1440, 1920] as const;
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'email-notice@example.invalid', firstName: 'Riley', lastName: 'Chen', role: 'CUSTOMER' };
const REF = orderDetails().orderReference;
type Email = OrderDetails['emailConfirmation'];
const paid = (emailConfirmation?: Email, over: Partial<OrderDetails> = {}) => ({ ...orderDetails(), ...(emailConfirmation ? { emailConfirmation } : {}), ...over });
const at = (state: NonNullable<Email>['state']) => ({ state, updatedAt: '2026-10-18T12:00:00.000Z' });

async function harness(page: Page, details: () => OrderDetails | number) {
  const writes: string[] = [];
  await page.addInitScript(value => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)); }, user);
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !path.startsWith('/api/auth/')) writes.push(`${request.method()} ${path}`);
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path.startsWith('/api/auth/')) return path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'intercepted-email-token', user });
    if (path === '/api/cart') return send({ data: { revision: 'a'.repeat(64), items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } });
    if (path === '/api/wishlist') return send({ data: { items: [], totalItems: 0 } });
    if (path === '/api/checkout/payment-attempts') return send({ data: [] });
    const match = /^\/api\/orders\/([^/]+)(\/confirmation)?$/.exec(path);
    if (match) {
      const found = details();
      if (typeof found === 'number') return send({ error: { code: found === 404 ? 'ORDER_NOT_FOUND' : 'INTERNAL', message: 'Order not found.' } }, found);
      return decodeURIComponent(match[1]!) === found.orderReference ? send({ data: found }) : send({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } }, 404);
    }
    return send({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  });
  return writes;
}
const notice = (page: Page) => page.locator('[data-email-state]');
async function shot(page: Page, name: string, width: number) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.describe('E01/E02/E04/E05 Confirmation: card → notice → actions; navigation never writes', () => {
  test('queued notice sits between the card and the outside-card actions; details reachable; refresh/back/forward cause no write', async ({ page }) => {
    const writes = await harness(page, () => paid(at('QUEUED')));
    await page.goto(`/checkout/confirmation/${REF}`);
    await expect(notice(page)).toContainText('Your order and payment confirmations are queued. You can view your order details now.');
    const order = await page.evaluate(() => {
      const card = document.querySelector('[data-email-state]')!.previousElementSibling!;
      const actions = document.querySelector('[data-email-state]')!.nextElementSibling!;
      return { cardIsSection: card.tagName, actionsHaveDetails: actions.textContent?.includes('View Order Details') && actions.textContent.includes('Continue Shopping') };
    });
    expect(order).toEqual({ cardIsSection: 'SECTION', actionsHaveDetails: true });
    const link = page.getByRole('link', { name: 'View Order Details' });
    await expect(link).toBeEnabled();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/orders/${REF}$`));
    await expect(notice(page)).toBeVisible();
    await page.reload(); await expect(notice(page)).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/checkout\/confirmation/);
    await page.goForward(); await expect(page).toHaveURL(new RegExp(`/orders/${REF}$`));
    expect(writes).toEqual([]);
  });
});

test.describe('E03/E10/E11/E12 truthful copy per projection', () => {
  const cases: [string, Email | undefined, string][] = [
    ['delayed', at('DELAYED'), 'Your confirmation emails are taking a little longer. Your order and payment are confirmed.'],
    ['sent', at('SENT'), 'Your order and payment confirmations have been sent. Check your inbox or spam folder.'],
    ['partial', at('PARTIAL'), 'Some confirmation emails are still pending or could not be confirmed. Your purchase is confirmed.'],
    ['unavailable', at('UNAVAILABLE'), 'Your purchase is confirmed. We couldn’t confirm email delivery. Your order details are available here.'],
    ['historical', undefined, 'Your order details are saved here for reference.'],
  ];
  for (const [name, email, copy] of cases) test(name, async ({ page }) => {
    await harness(page, () => paid(email));
    await page.goto(`/orders/${REF}`);
    await expect(notice(page)).toContainText(copy);
    await expect(page.getByRole('heading', { name: /Items/i }).first()).toBeVisible(); // purchase content still renders
    await expect(page.getByRole('alert')).toHaveCount(0); // never presented as a failure
    if (name === 'sent') await expect(notice(page)).not.toContainText('delivered');
    if (name === 'historical') await expect(notice(page)).not.toContainText(/queued|sent|delivered/i);
  });
});

test.describe('E08/E09/E16 no success notice for unpaid, failed, cancelled or refunded orders', () => {
  for (const [name, over] of [['pending', { paymentState: 'PENDING', status: 'AWAITING_CAPTURE' }], ['failed', { paymentState: 'FAILED', status: 'CANCELLED' }],
    ['cancelled-refunded', { paymentState: 'REFUNDED', status: 'CANCELLED' }]] as const) {
    test(name, async ({ page }) => {
      await harness(page, () => paid(at('SENT'), over as Partial<OrderDetails>));
      await page.goto(`/orders/${REF}`);
      await expect(page.getByText(REF).first()).toBeVisible();
      await expect(notice(page)).toHaveCount(0);
      await expect(page.getByText(/confirmations have been sent/)).toHaveCount(0);
    });
  }
});

test('E07 another customer’s order is the same 404 with no email information', async ({ page }) => {
  await harness(page, () => 404);
  await page.goto(`/orders/${REF}`);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});

test('E14 a failed background refresh keeps the loaded order and its email notice; no payment error', async ({ page }) => {
  let reads = 0;
  await harness(page, () => (++reads > 1 ? 500 : paid(at('SENT'))));
  await page.goto(`/orders/${REF}`);
  await expect(notice(page)).toContainText('have been sent');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(notice(page)).toContainText('have been sent');
  await expect(page.getByText(/payment (failed|declined)/i)).toHaveCount(0);
});

test('E18 keyboard: focus moves past the notice to View Order Details with a visible indicator; nothing in the notice is focusable', async ({ page }) => {
  await harness(page, () => paid(at('QUEUED')));
  await page.goto(`/checkout/confirmation/${REF}`);
  await expect(notice(page)).toBeVisible();
  expect(await notice(page).locator('a, button, [tabindex]').count()).toBe(0);
  const link = page.getByRole('link', { name: 'View Order Details' });
  await link.focus();
  const outline = await link.evaluate(element => { const style = getComputedStyle(element); return `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`; });
  expect(outline).not.toBe('none 0px none');
});

test.describe('E17 responsive captures (390/768/1440/1920)', () => {
  for (const width of WIDTHS) test(`confirmation and details at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await harness(page, () => ({ ...manyItemsDetails(), orderReference: REF, emailConfirmation: at('DELAYED') }));
    await page.goto(`/checkout/confirmation/${REF}`);
    await expect(notice(page)).toBeVisible(); await noOverflow(page);
    const geometry = await page.evaluate(() => {
      const box = document.querySelector('[data-email-state]')!.getBoundingClientRect();
      const card = document.querySelector('[data-email-state]')!.previousElementSibling!.getBoundingClientRect();
      return { left: Math.round(box.left - card.left), width: Math.round(box.width - card.width) };
    });
    expect(Math.abs(geometry.left)).toBeLessThanOrEqual(1); expect(Math.abs(geometry.width)).toBeLessThanOrEqual(1);
    await shot(page, 'confirmation-delayed', width);
    await page.goto(`/orders/${REF}`);
    await expect(notice(page)).toBeVisible(); await noOverflow(page);
    await shot(page, 'details-delayed', width);
  });
});
