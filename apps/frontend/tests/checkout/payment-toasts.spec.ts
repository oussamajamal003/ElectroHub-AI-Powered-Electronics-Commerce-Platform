import { expect, test, type Page } from '@playwright/test';
import { harness } from './stripe.harness';

type Row = { attemptId: string; scope: string; state: string; classification: string; total: string; currency: string; pending: boolean; unread: boolean;
  orderReference: string | null; retryAllowed?: boolean; items: { name: string; quantity: number }[] };
const base = (id: string, name: string): Row => ({ attemptId: id, scope: 'CART_CHECKOUT', state: 'PROCESSING', classification: 'PROCESSING', total: '49.00', currency: 'USD',
  pending: true, unread: false, orderReference: null, items: [{ name, quantity: 1 }] });
const A = '79972f29-3ac6-4093-aee8-5d148acc95a4'; const C = '0b6d4f4e-5d62-4c53-9d6c-1f5f1d7f0c11';
const paid = (row: Row): Row => ({ ...row, state: 'PAID', classification: 'SUCCEEDED', pending: false, unread: true, orderReference: `ORD-${row.attemptId.slice(0, 4)}` });
const declined = (row: Row): Row => ({ ...row, state: 'DECLINED', classification: 'DECLINED', pending: false, unread: true, retryAllowed: true });
const SUCCESS = 'Payment successful! Your order has been confirmed.';
const FAILURE = 'Payment was not completed. Your saved purchase details are kept in your Cart history.';

async function serve(page: Page, initial: Row[]) {
  const api = await harness(page); let rows = initial; const acknowledged: string[] = [];
  await page.route('**/api/checkout/payment-attempts**', route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/checkout/payment-attempts') return route.fulfill({ json: { data: rows } });
    if (method === 'POST' && url.pathname.endsWith('/read')) { acknowledged.push(url.pathname.split('/').at(-2) ?? ''); return route.fulfill({ json: { data: {} } }); }
    return route.fallback();
  });
  await page.route('**/api/orders**', route => route.request().method() === 'GET' ? route.fulfill({ json: { data: [], meta: { total: 0, page: 1, totalPages: 0 } } }) : route.fallback());
  return { api, acknowledged, set: (next: Row[]) => { rows = next; },
    refetch: () => page.evaluate(() => { window.dispatchEvent(new Event('visibilitychange')); }) };
}
const toasts = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test.describe(`payment toasts at ${viewport.width}px`, () => {
    test.use({ viewport });
    for (const path of ['/', '/products', '/cart', '/orders', '/checkout']) for (const [label, make, text] of [['PAID', paid, SUCCESS], ['DECLINED', declined, FAILURE]] as const) {
      test(`${label} while viewing ${path} (cold load) shows exactly one toast`, async ({ page }) => {
        await serve(page, [make(base(A, 'Mouse A'))]);
        await page.goto(path);
        await expect(page.getByText(text, { exact: true })).toHaveCount(1, { timeout: 15000 });
        await expect(toasts(page)).toHaveCount(1);
        await expect(page.getByText(text, { exact: true })).toBeHidden({ timeout: 9000 });
      });
    }
    for (const [label, make, text] of [['PAID', paid, SUCCESS], ['DECLINED', declined, FAILURE]] as const) {
      test(`${label} arriving while on Cart (pending → terminal)`, async ({ page }) => {
        const feed = await serve(page, [base(A, 'Mouse A')]);
        await page.goto('/cart'); await expect(page.getByText('Mouse A').first()).toBeVisible();
        feed.set([make(base(A, 'Mouse A'))]); await feed.refetch();
        await expect(page.getByText(text, { exact: true })).toHaveCount(1, { timeout: 8000 });
        await feed.refetch(); await page.waitForTimeout(500);
        await expect(toasts(page)).toHaveCount(1);
        await expect(page.getByText(text, { exact: true })).toBeHidden({ timeout: 9000 });
        await feed.refetch(); await page.waitForTimeout(800); await expect(toasts(page)).toHaveCount(0);
      });
    }
    test('pending, UNKNOWN and failed requests never toast', async ({ page }) => {
      const feed = await serve(page, [base(A, 'Mouse A'), { ...base(C, 'Cable C'), state: 'UNKNOWN', classification: 'UNKNOWN' }]);
      await page.goto('/cart'); await page.waitForTimeout(1200); await expect(toasts(page)).toHaveCount(0);
      await page.route('**/api/checkout/payment-attempts', route => route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: { code: 'X', message: 'down' } } }) : route.fallback());
      await feed.refetch(); await page.waitForTimeout(1200); await expect(toasts(page)).toHaveCount(0);
    });
    test('two purchases give one toast each and survive navigation without repeating', async ({ page }) => {
      const feed = await serve(page, [base(A, 'Mouse A'), base(C, 'Cable C')]);
      await page.goto('/cart'); await expect(page.getByText('Mouse A').first()).toBeVisible();
      feed.set([paid(base(A, 'Mouse A')), declined(base(C, 'Cable C'))]); await feed.refetch();
      await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 8000 });
      await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(1);
      await page.getByRole('link', { name: 'Home' }).first().click().catch(() => undefined);
      await page.goto('/orders'); await page.waitForTimeout(800);
      await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0); await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(0);
    });
    test('late A result on Checkout B toasts once and leaves B untouched', async ({ page }) => {
      const feed = await serve(page, [base(A, 'Mouse A')]);
      await page.goto('/checkout'); await page.locator('#shipping-recipient').fill('Checkout B recipient');
      feed.set([paid(base(A, 'Mouse A'))]); await feed.refetch();
      await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 8000 });
      await expect(page.locator('#shipping-recipient')).toHaveValue('Checkout B recipient'); await expect(page).toHaveURL(/\/checkout/);
      const box = await page.getByText(SUCCESS, { exact: true }).boundingBox();
      console.log(`[${viewport.width}] toast box`, JSON.stringify(box));
      await page.screenshot({ path: `test-results/checkout/payment-toast-${viewport.width}-checkout-b.png` });
    });
  });
}

test.describe('navigation, acknowledgement and dedicated screens', () => {
  test('toast survives in-app navigation, never repeats, and is acknowledged once', async ({ page }) => {
    const feed = await serve(page, [paid(base(A, 'Mouse A'))]);
    await page.goto('/cart');
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('link', { name: 'Products', exact: true }).first().click().catch(async () => { await page.evaluate(() => { history.pushState({}, '', '/products'); dispatchEvent(new PopStateEvent('popstate')); }); });
    await expect(page).toHaveURL(/products/);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1);
    await feed.refetch(); await page.waitForTimeout(600); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    await feed.refetch(); await page.waitForTimeout(800); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    await page.reload(); await page.waitForTimeout(1500); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    expect(feed.acknowledged).toEqual([A]);
  });
  test('each failure toast links to its saved purchase in Cart, where Try Again lives when eligible', async ({ page }) => {
    await serve(page, [declined(base(A, 'Mouse A')), { ...declined(base(C, 'Cable C')), retryAllowed: false }]);
    await page.goto('/orders');
    await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(2, { timeout: 15000 });
    await expect(page.getByRole('link', { name: 'View saved purchase' })).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'View saved purchase' }).first()).toHaveAttribute('href', '/cart');
  });
  test('success toast links to the order', async ({ page }) => {
    await serve(page, [paid(base(A, 'Mouse A'))]);
    await page.goto('/'); await expect(page.getByRole('link', { name: 'View Order' })).toHaveAttribute('href', `/checkout/confirmation/ORD-${A.slice(0, 4)}`, { timeout: 15000 });
  });
  test('the dedicated Payment Failed screen suppresses only its own purchase', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const feed = await serve(page, []);
    await page.goto('/checkout');
    const { review } = await import('./stripe.harness');
    await review(page);
    await page.unroute('**/api/checkout/payment-attempts**');
    await page.route('**/api/checkout/payment-attempts**', route => {
      const url = new URL(route.request().url()); const method = route.request().method();
      if (method === 'GET' && url.pathname === '/api/checkout/payment-attempts') return route.fulfill({ json: { data: [
        { ...declined(base('44444444-4444-4444-8444-444444444444', 'Phone A')) }, paid(base(C, 'Cable C'))] } });
      return route.fallback();
    });
    feed.set([]);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 15000 });
    await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(0);
  });
});

test('a result arriving on Cart after the bounded Checkout hand-off toasts once', async ({ page }) => {
  await page.clock.install();
  const { attemptId } = await import('./stripe.harness'); const { review } = await import('./stripe.harness');
  await harness(page, { state: 'CAPTURE_PENDING' });
  let rows: Row[] = [{ ...base(attemptId, 'Phone A'), classification: 'UNKNOWN', state: 'CAPTURE_PENDING' }];
  await page.route('**/api/checkout/payment-attempts', route => route.request().method() === 'GET' ? route.fulfill({ json: { data: rows } }) : route.fallback());
  await page.goto('/checkout'); await review(page);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await page.clock.fastForward(121_000);
  await expect(page).toHaveURL(new RegExp(`/cart[?]purchase=${attemptId}$`));
  await expect(toasts(page)).toHaveCount(0);
  rows = [paid(base(attemptId, 'Phone A'))];
  await page.clock.fastForward(16_000);
  await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1);
  await page.clock.fastForward(60_000); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`toast never covers a primary action at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const feed = await serve(page, []);
    const overlaps = (path: string) => page.evaluate(() => {
      const toast = document.querySelector('ol[class*="paymentToasts"] li'); if (!toast) return ['no toast'];
      const t = toast.getBoundingClientRect();
      return [...document.querySelectorAll('main button, main a')].filter(el => !toast.contains(el) && /Proceed to Checkout|Continue to|Review Order|Place Order|Retry payment setup/.test(el.textContent ?? ''))
        .map(el => { const r = el.getBoundingClientRect(); const hit = r.width > 0 && r.right > t.left && r.left < t.right && r.bottom > t.top && r.top < t.bottom;
          return hit ? `${el.textContent?.trim()} @ ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} vs toast ${Math.round(t.x)},${Math.round(t.y)}` : null; }).filter(Boolean) as string[];
    }).then(list => { if (path) console.log(`[${viewport.width}] ${path}:`, JSON.stringify(list)); return list; });
    for (const path of ['/cart', '/checkout']) {
      feed.set([]); await page.goto(path); await page.waitForTimeout(1200);
      feed.set([paid(base(A, 'Mouse A'))]); await feed.refetch();
      const text = page.getByText(SUCCESS, { exact: true }); await expect(text).toHaveCount(1, { timeout: 10000 });
      await text.evaluate(async element => { await Promise.all(element.closest('li')?.getAnimations().map(animation => animation.finished) ?? []); });
      expect(await overlaps(path)).toEqual([]);
      await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
      await page.evaluate(() => localStorage.clear());
    }
  });
}

/** Notification ownership: backend `unread` decides whether a result is new; the browser-local key only stops this browser repeating it. */
const noticeKey = (state: string) => `electrohub.payment-notice.11111111-1111-4111-8111-111111111111.${A}.${state}`;
const hide = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => Reflect.get(window, '__hidden') ? 'hidden' : 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => Boolean(Reflect.get(window, '__hidden')) });
  Reflect.set(window, '__hidden', true);
});
const show = (page: Page) => page.evaluate(() => { Reflect.set(window, '__hidden', false); document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });

test.describe('notification reliability', () => {
  test('backend unread + a local key for the same attempt and state: this browser does not repeat it; other states and attempts still toast', async ({ page }) => {
    await serve(page, [paid(base(A, 'Mouse A')), declined(base(C, 'Cable C'))]);
    await page.addInitScript(key => localStorage.setItem(key, 'shown'), noticeKey('PAID'));
    await page.goto('/');
    await expect(page.getByText(FAILURE, { exact: true })).toHaveCount(1, { timeout: 15000 });
    await page.waitForTimeout(800); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
  });
  test('a hidden tab never consumes the notice: the visible tab still shows it, exactly once across both', async ({ page, context }) => {
    const second = await context.newPage();
    await serve(page, [paid(base(A, 'Mouse A'))]); await serve(second, [paid(base(A, 'Mouse A'))]);
    await hide(page);
    await page.goto('/'); await page.waitForTimeout(7000);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), noticeKey('PAID'))).toBeNull();
    await second.goto('/');
    await expect(second.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 15000 });
    await show(page); await page.waitForTimeout(1500);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
  });
  test('a tab that becomes visible later shows a result that arrived while it was hidden', async ({ page }) => {
    await serve(page, [paid(base(A, 'Mouse A'))]);
    await hide(page); await page.goto('/cart'); await page.waitForTimeout(1500);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    await show(page);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 10000 });
  });
  test('/read failing temporarily: shown once, acknowledgement error surfaced, no repeat here, server truth shows it again in a clean browser', async ({ page, browser }) => {
    const feed = await serve(page, [paid(base(A, 'Mouse A'))]);
    await page.route('**/api/checkout/payment-attempts/*/read', route => route.fulfill({ status: 503, json: { error: { code: 'X', message: 'down' } } }));
    await page.goto('/'); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
    // Radix also announces this text in an off-screen live region; assert the visible toast itself.
    await expect(page.getByRole('region', { name: 'Notifications (F8)' }).getByText(/acknowledgement could not be saved/i)).toBeVisible();
    await feed.refetch(); await page.reload(); await page.waitForTimeout(1500);
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    const clean = await (await browser.newContext()).newPage(); await serve(clean, [paid(base(A, 'Mouse A'))]);
    await clean.goto('/'); await expect(clean.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 15000 });
  });
  test('a toast withdrawn before it was ever presented is shown again, never lost', async ({ page }) => {
    await serve(page, [paid(base(A, 'Mouse A'))]);
    await page.goto('/cart'); await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
    await expect(page.getByText(SUCCESS, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), noticeKey('PAID'))).toBe('shown');
  });
});
