import { test, expect, type Page } from '@playwright/test';
import { harness, fillShipping, fillCard } from './stripe.harness';
import { cart, quote, shipping } from '../../src/features/checkout/fixtures';
import type { SavedPurchase } from '../../src/features/checkout/PaymentPurchases';

const evidence = new WeakMap<Page, { method: string; path: string; status: number; publicCode?: string }[]>();
test.beforeEach(async ({ page }) => {
  const records: { method: string; path: string; status: number; publicCode?: string }[] = []; evidence.set(page, records);
  page.on('response', async response => {
    const path = new URL(response.url()).pathname; if (!path.startsWith('/api/')) return;
    const record = { method: response.request().method(), path, status: response.status() };
    records.push(record);
    if (response.status() >= 400) {
      const body = await response.json().catch(() => null);
      const publicCode = body?.error?.code;
      if (typeof publicCode === 'string' && /^[A-Z0-9_]{1,100}$/.test(publicCode)) Object.assign(record, { publicCode });
    }
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('sanitized-intercepted-api-responses', { body: Buffer.from(JSON.stringify(evidence.get(page) ?? [], null, 2)), contentType: 'application/json' });
});

const purchase: SavedPurchase = { attemptId: '79972f29-3ac6-4093-aee8-5d148acc95a4', scope: 'CART_CHECKOUT',
  state: 'PROCESSING', classification: 'PROCESSING', pending: true, unread: false, total: '49.00', currency: 'USD',
  orderReference: null, submittedAt: '2026-10-14T08:00:00Z', items: [{ name: 'Lenovo Go USB-C Wireless Mouse', quantity: 1,
    imageUrl: '/images/catalog/variety/accessory-lenovo-mouse-01.jpg' }] };
async function scenario(page: Page) {
  const base = await harness(page);
  await page.route('**/api/cart', route => route.fulfill({ json: { data: cartB } }));
  let rows = [purchase]; let reads = 0; let failure: 'http' | 'network' | null = null;
  await page.route('**/api/checkout/payment-attempts', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    reads++;
    if (failure === 'network') return route.abort('failed');
    if (failure === 'http') return route.fulfill({ status: 503, json: { error: { code: 'PAYMENT_UNAVAILABLE', message: 'Temporarily unavailable.' } } });
    return route.fulfill({ json: { data: rows } });
  });
  return { ...base, setRows: (next: SavedPurchase[]) => { rows = next; }, reads: () => reads,
    fail: (next: typeof failure) => { failure = next; } };
}
const terminal = (state: 'PAID' | 'DECLINED'): SavedPurchase => ({ ...purchase, state,
  classification: state === 'PAID' ? 'SUCCEEDED' : 'DECLINED', pending: false, unread: true,
  retryAllowed: state === 'DECLINED', orderReference: state === 'PAID' ? 'ORD-A' : null });

test('foreground purchase remains observable after the initial five-minute window', async ({ page }) => {
  await page.clock.install(); const flow = await scenario(page); await page.goto('/cart');
  await expect(page.getByText(purchase.items[0].name)).toBeVisible({ timeout: 15000 });
  // Advance each poll only after its response completes; fastForward over five
  // minutes at once skips interval callbacks and does not model continued use.
  for (let index = 0; index < 19; index++) {
    const before = flow.reads(); await page.clock.fastForward(15_001);
    await expect.poll(flow.reads).toBeGreaterThan(before);
    await expect(page.getByText(purchase.items[0].name, { exact: true })).toBeVisible();
  }
  // Past the five-minute window reads back off to 60 s (no time cap); a terminal result is still discovered without a refresh.
  const boundary = flow.reads(); await page.clock.fastForward(15_001); await expect.poll(flow.reads).toBeGreaterThan(boundary); // last 15 s read at five minutes
  const before = flow.reads(); flow.setRows([terminal('PAID')]);
  await page.clock.fastForward(30_001); await page.waitForTimeout(500);
  expect(flow.reads()).toBe(before); // no high-frequency polling after the window
  await page.clock.fastForward(30_001);
  await expect.poll(flow.reads).toBeGreaterThan(before);
  await expect(page.locator('[data-outcome="success"]')).toBeVisible();
  await page.clock.fastForward(451);
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
});

test('transient saved-purchase read failure retains known pending cards and then recovers', async ({ page }) => {
  await page.clock.install(); const flow = await scenario(page); await page.goto('/cart');
  await expect(page.getByText(purchase.items[0].name)).toBeVisible(); flow.fail('http');
  const before = flow.reads(); await page.clock.fastForward(15_001); await expect.poll(flow.reads).toBeGreaterThan(before);
  await expect(page.getByText(purchase.items[0].name)).toBeVisible();
  await expect(page.getByText(/could not be updated/)).toBeVisible();
  flow.fail(null); flow.setRows([terminal('DECLINED')]); await page.clock.fastForward(15_001);
  await expect(page.locator('[data-outcome="failure"]')).toBeVisible(); await page.clock.fastForward(451);
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible(); await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
});

test('a toast presented outside Cart survives navigation into Cart without duplicating', async ({ page }) => {
  await page.clock.install(); const flow = await scenario(page);
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key.startsWith('electrohub.payment-notice.')) throw Error('storage unavailable'); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('electrohub.payment-notice.')) throw Error('storage unavailable'); return set.call(this, key, value); };
  });
  flow.setRows([terminal('PAID')]); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(1);
  // Hold page time so a slow route load cannot outlast the toast's own 5 s lifetime.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
  // Re-enter Cart through the real router and return without acknowledging by close.
  await page.getByRole('link', { name: /^Cart/ }).first().click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(1);
});

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const attemptB = '88888888-8888-4888-8888-888888888888';
const productB = { id: '99999999-9999-4999-8999-999999999999', name: 'Samsung Galaxy Buds2 Pro', slug: 'scenario-one-buds',
  price: '149.00', description: 'Independent shopping after submitting Purchase A.', compareAtPrice: null, discountPercent: null,
  averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 10,
  purchasable: true, category: { id: 'category', name: 'Headphones', slug: 'audio' }, brand: null, sku: 'B-OFFLINE', modelNumber: null,
  specifications: [], images: [{ id: 'image-b', url: '/images/catalog/variety/galaxybuds-01.jpg', altText: 'Galaxy Buds', isPrimary: true, sortOrder: 0 }] };
const cartA = { ...cart, revision: 'a'.repeat(64), totalQuantity: 1, subtotal: '49.00', total: '49.00',
  items: [{ ...cart.items[0], quantity: 1, product: { ...cart.items[0].product!, name: purchase.items[0].name, price: '49.00',
    image: { url: purchase.items[0].imageUrl!, altText: 'Wireless Mouse' } }, lineTotal: '49.00' }] };
const cartB = { ...cart, revision: 'b'.repeat(64), totalQuantity: 1, subtotal: '149.00', total: '149.00',
  items: [{ ...cart.items[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', productId: productB.id, quantity: 1,
    product: { name: productB.name, price: productB.price, category: 'Headphones', slug: productB.slug,
      image: { url: productB.images[0].url, altText: 'Galaxy Buds' } }, lineTotal: '149.00' }] };
async function journey(page: Page) {
  const base = await harness(page); let current = cartA; let rows: SavedPurchase[] = [];
  const requests: { method: string; path: string; key?: string; status: number }[] = [];
  let setupGate: ReturnType<typeof gate> | null = null;
  let oldSetupFailureGate: ReturnType<typeof gate> | null = null;
  let recoveryState = 'PROCESSING';
  const outcome = (id: string, state = 'AWAITING_INPUT') => ({ attemptId: id, scope: 'CART_CHECKOUT', state,
    classification: state === 'RECOVERY_PENDING' ? 'UNKNOWN' : state === 'PROCESSING' ? 'PROCESSING' : 'NOT_SUBMITTED', cartIdentity: 'current-cart', cartRevision: current.revision,
    intentId: id === purchase.attemptId ? 'pi_A' : 'pi_B', recoveryActive: false, committed: false, confirmation: null,
    submittedAt: ['PROCESSING', 'RECOVERY_PENDING'].includes(state) ? purchase.submittedAt : null, total: current.total, currency: 'USD', cart: current,
    providerStatus: state === 'RECOVERY_PENDING' ? null : state === 'PROCESSING' ? 'processing' : 'requires_payment_method', orderReference: null });
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    const send = (data: unknown, status = 200) => { requests.push({ path, method, status, key: req.headers()['idempotency-key'] }); return route.fulfill({ status, json: data }); };
    if (path === '/api/cart') return send({ data: current });
    if (path.startsWith('/api/cart/items/') && method === 'DELETE') {
      current = { ...cartA, items: [], subtotal: '0.00', total: '0.00', totalQuantity: 0, canCheckout: false };
      return send({ data: current });
    }
    if (path === '/api/wishlist') return send({ data: { items: [{ productId: productB.id, product: { ...productB, primaryImage: productB.images[0] }, availability: 'AVAILABLE' }], totalItems: 1 } });
    if (path === '/api/cart/items') { expect(req.postDataJSON()).toEqual({ productId: productB.id, quantity: 1 }); current = cartB; return send({ data: current }); }
    if (path === `/api/products/${productB.slug}`) return send({ data: productB });
    if (path.startsWith(`/api/products/${productB.slug}/reviews`)) return send({ data: path.endsWith('/me') ? null : [],
      summary: { averageRating: null, reviewCount: 0 }, meta: { page: 1, total: 0, totalPages: 0 } });
    if (path === '/api/checkout') return send({ data: { ...quote, cartRevision: current.revision, subtotal: current.subtotal,
      deliveryMethods: quote.deliveryMethods.map(method => ({ ...method, totals: { ...method.totals, subtotal: current.subtotal,
        total: (Number(current.subtotal) + Number(method.price)).toFixed(2) } })) } });
    if (path === '/api/checkout/payment-attempts') {
      if (method === 'GET') return send({ data: rows });
      const id = current.revision === cartA.revision ? purchase.attemptId : attemptB;
      if (id === purchase.attemptId && oldSetupFailureGate) {
        await oldSetupFailureGate.promise;
        return send({ error: { code: 'PAYMENT_UNAVAILABLE', message: 'Temporary setup failure.' } }, 503);
      }
      if (setupGate) await setupGate.promise;
      return send({ data: { ...outcome(id), clientSecret: id === attemptB ? 'pi_B_secret_intercepted' : 'pi_A_secret_intercepted', replayed: false } }, 201);
    }
    if (path.endsWith('/submit')) {
      expect(path).toContain(purchase.attemptId); rows = [purchase];
      const submitted = { ...outcome(purchase.attemptId), submittedAt: purchase.submittedAt };
      current = { ...cartA, items: [], subtotal: '0.00', total: '0.00', totalQuantity: 0, canCheckout: false };
      return send({ data: submitted });
    }
    if (path.endsWith('/reconcile')) return send({ data: { ...outcome(purchase.attemptId, recoveryState), cartRevision: cartA.revision } }, 202);
    if (path.endsWith('/read')) return send({});
    if (path === '/api/checkout/payment-attempts/' + purchase.attemptId) return send({ data: { ...outcome(purchase.attemptId, recoveryState), cartRevision: cartA.revision } });
    return route.fallback();
  });
  return { ...base, requests, setRows: (value: SavedPurchase[]) => { rows = value; }, holdSetup: () => { setupGate = gate(); return setupGate.release; },
    failOldSetupLate: () => { oldSetupFailureGate = gate(); return oldSetupFailureGate.release; },
    unknown: () => { recoveryState = 'RECOVERY_PENDING'; } };
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/scenario1-browser/${name}.png`, fullPage: true });
}
async function geometry(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const row of await page.locator('[data-purchase]').all()) {
    const box = await row.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  }
}

for (const width of [390, 768, 1440, 1920]) test(`complete A submission → Home → Cart → add B → clean Checkout B at ${width}px`, async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width, height: 900 }); const flow = await journey(page);
  await page.goto('/checkout'); await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
  await page.getByRole('button', { name: /Place Order/ }).click();
  // Stage 1 lasts while Place Order is in flight; an unresolved settled result moves to Stage 2 verification.
  await expect.poll(() => flow.requests.filter(r => r.path.endsWith('/reconcile')).length).toBe(1);
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try Again|View Orders/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Order Summary' })).toHaveCount(0); await shot(page, `${width}-checking`);
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click(); await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: /^Cart/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pending purchases \(/ })).toHaveCount(0);
  await page.getByRole('link', { name: /^Wishlist/ }).first().click();
  await page.getByRole('link', { name: new RegExp(productB.name) }).first().click();
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
  await page.getByRole('link', { name: /^Cart/ }).first().click();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText('$149.00');
  await expect(page.getByRole('complementary', { name: 'Order Summary' })).not.toContainText('$49.00');
  await geometry(page); await shot(page, `${width}-cart-pending-A-active-B`);
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  await fillShipping(page); const release = flow.holdSetup(); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible(); await shot(page, `${width}-B-skeleton`); release();
  await fillCard(page); await expect(page.getByRole('alert')).toHaveCount(0); await geometry(page); await shot(page, `${width}-B-ready`);
  expect(flow.requests.filter(r => r.path === '/api/checkout/payment-attempts' && r.method === 'POST')).toHaveLength(2);
  expect(new Set(flow.requests.filter(r => r.path === '/api/checkout/payment-attempts' && r.method === 'POST').map(r => r.key)).size).toBe(2);
  expect(flow.requests.filter(r => r.path.endsWith('/submit'))).toHaveLength(1); expect(await flow.confirms()).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').clientSecrets)).toContain('pi_B_secret_intercepted');
  flow.setRows([terminal('PAID')]); await page.clock.fastForward(15_001);
  await expect(page.getByText('Payment successful! Your order has been confirmed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled(); await expect(page).toHaveURL(/step=payment/);
  await page.getByRole('button', { name: 'Dismiss payment notification' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').clientSecrets)).not.toContain('pi_A_secret_intercepted_late');
});

for (const state of ['PAID', 'DECLINED'] as const) for (const width of [390, 768, 1440, 1920]) test(`${state} inline exit and outside-Cart toast geometry at ${width}px`, async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width, height: 900 }); const flow = await scenario(page); await page.goto('/cart');
  await expect(page.getByText(purchase.items[0].name)).toBeVisible({ timeout: 15000 });
  flow.setRows([terminal(state)]); await page.clock.fastForward(15_001);
  const outcome = page.locator('[data-outcome]'); await expect(outcome).toBeVisible(); await shot(page, `${width}-${state}-inline`);
  await page.clock.fastForward(451); await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  // Cart also receives the global toast for A, exactly once; it auto-dismisses after 5 s.
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(1);
  await page.clock.fastForward(5_001);
  await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(0); await geometry(page); await shot(page, `${width}-${state}-cart-clean`);
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(state === 'DECLINED' ? 1 : 0);
  // A separate, unread outcome arrives outside Cart; the already presented A must remain deduplicated.
  flow.setRows([{ ...terminal(state), attemptId: attemptB }]); await page.getByRole('link', { name: 'ElectroHub — Home' }).click();
  // No unresolved purchases remain, so normal polling correctly stops. A tab
  // visibility/focus event requests fresh backend truth rather than a timer loop.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  const close = page.getByRole('button', { name: 'Dismiss payment notification' }); await expect(close).toHaveCount(1);
  const toast = page.locator('[data-state="open"]').filter({ has: close });
  await expect(toast).toBeVisible(); await page.mouse.move(0, 0);
  await toast.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const box = await toast.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeGreaterThan(width - 30); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  // Bottom-right from tablet up. Phones stack checkout actions full-width at the bottom, so the payment notice
  // sits below the sticky header there (Scenarios 2–6: it must not cover Checkout B's Review/Place Order).
  if (width >= 768) { expect(box!.y + box!.height).toBeGreaterThan(850); expect(box!.y + box!.height).toBeLessThanOrEqual(900); }
  else { expect(box!.y).toBeGreaterThanOrEqual(56); expect(box!.y + box!.height).toBeLessThan(260); }
  await shot(page, `${width}-${state}-toast`); await page.clock.fastForward(5001); await expect(close).toHaveCount(0);
});

test('UNKNOWN survives network failure, refresh and a reopened tab; later truth resolves it', async ({ page, context }) => {
  await page.clock.install(); const flow = await scenario(page); flow.setRows([{ ...purchase, classification: 'UNKNOWN' }]); await page.goto('/cart');
  await expect(page.getByText('Awaiting confirmation')).toBeVisible(); flow.fail('network');
  await page.clock.fastForward(15_001); await expect(page.getByText(/could not be updated/)).toBeVisible();
  await expect(page.getByText('Awaiting confirmation')).toBeVisible(); await expect(page.getByRole('link', { name: 'Try Again' })).toHaveCount(0);
  flow.fail(null); await page.reload(); await expect(page.getByText('Awaiting confirmation')).toBeVisible();
  const second = await context.newPage(); const other = await scenario(second); other.setRows([{ ...purchase, classification: 'UNKNOWN' }]);
  await second.goto('/cart'); await expect(second.getByText('Awaiting confirmation')).toBeVisible(); await page.close();
  const reopened = await context.newPage(); const recovered = await scenario(reopened); recovered.setRows([terminal('DECLINED')]);
  await reopened.goto('/cart'); await expect(reopened.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await expect(reopened.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  await expect(reopened.getByRole('link', { name: /^Try Again/ })).toHaveCount(1); await second.close();
});

test('genuine setup 503 remains actionable and no financial retry is automatic', async ({ page }) => {
  const flow = await harness(page, { unavailable: true }); await page.goto('/checkout'); await fillShipping(page);
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('alert')).toContainText('Secure payment setup could not finish');
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeDisabled();
  expect(flow.requests.filter(r => r.path === '/api/checkout/payment-attempts' && r.method === 'POST')).toHaveLength(1);
  expect(await flow.confirms()).toBe(0);
});

test('legacy status bookmark retains A identity and does not initialize payment', async ({ page }) => {
  const flow = await scenario(page); await page.goto('/account/payment-status/' + purchase.attemptId);
  await expect(page).toHaveURL('/cart?purchase=' + purchase.attemptId);
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  await expect(page.getByText('Checking your payment', { exact: true })).toHaveCount(0);
  expect(flow.requests.filter(r => r.method === 'POST' && r.path.includes('payment-attempts'))).toHaveLength(0);
});

test('foreground UNKNOWN exits the bounded processing screen with durable A and no second submission', async ({ page }) => {
  await page.clock.install(); const flow = await journey(page); flow.unknown(); await page.goto('/checkout');
  await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click(); await fillCard(page);
  await page.getByRole('button', { name: 'Review Order' }).click(); await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  flow.setRows([{ ...purchase, state: 'RECOVERY_PENDING', classification: 'UNKNOWN' }]);
  await page.clock.fastForward(120_001); await expect(page).toHaveURL('/cart?purchase=' + purchase.attemptId);
  await expect(page.getByText('Awaiting confirmation')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Processing your order…' })).toHaveCount(0);
  expect(flow.requests.filter(r => r.path.endsWith('/submit'))).toHaveLength(1); expect(await flow.confirms()).toBe(1);
  await expect(page.getByRole('link', { name: 'Try Again' })).toHaveCount(0);
});

test('old checkout setup 503 arriving after B fields load cannot contaminate B', async ({ page }) => {
  const flow = await journey(page); const release = flow.failOldSetupLate();
  await page.goto('/checkout'); await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
  await page.getByRole('link', { name: /^Cart/ }).first().click();
  await page.getByRole('button', { name: 'Remove ' + purchase.items[0].name + ' from cart' }).click();
  await page.getByRole('link', { name: /^Wishlist/ }).first().click();
  await page.getByRole('link', { name: new RegExp(productB.name) }).first().click();
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
  await page.getByRole('link', { name: /^Cart/ }).first().click(); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click(); await fillCard(page);
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/checkout/payment-attempts' && response.status() === 503);
  release(); await failed;
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').clientSecrets)).toContain('pi_B_secret_intercepted');
  expect(flow.requests.filter(r => r.method === 'POST' && r.path === '/api/checkout/payment-attempts')).toHaveLength(2);
  expect(await flow.confirms()).toBe(0);
});

test('read deadline and an aborted late UNKNOWN response cannot undo verified terminal truth', async ({ page }) => {
  const flow = await scenario(page); await page.goto('/cart'); await expect(page.getByText(purchase.items[0].name)).toBeVisible();
  const held = gate(); let calls = 0;
  await page.route('**/api/checkout/payment-attempts', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    calls++;
    if (calls === 1) { await held.promise; return route.fulfill({ json: { data: [{ ...purchase, classification: 'UNKNOWN' }] } }).catch(() => {}); }
    return route.fulfill({ json: { data: [terminal('DECLINED')] } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByText(/could not be updated/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(purchase.items[0].name)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  held.release(); await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
  expect(flow.requests.filter(r => r.method === 'POST' && r.path.includes('payment-attempts'))).toHaveLength(0);
});

test('simultaneous tabs deduplicate two independent outcomes; reload does not replay them', async ({ page, context }) => {
  const second = await context.newPage(); const rows = [terminal('PAID'), { ...terminal('DECLINED'), attemptId: attemptB }];
  for (const tab of [page, second]) { await tab.clock.install(); const flow = await scenario(tab); flow.setRows(rows); }
  await Promise.all([page.goto('/'), second.goto('/')]);
  await expect.poll(async () => await page.getByRole('button', { name: 'Dismiss payment notification' }).count() +
    await second.getByRole('button', { name: 'Dismiss payment notification' }).count()).toBe(2);
  for (const message of ['Payment successful! Your order has been confirmed.', 'Payment was not completed. Your saved purchase details are kept in your Cart history.']) {
    expect(await page.locator('li[data-state="open"]').filter({ hasText: message }).count() +
      await second.locator('li[data-state="open"]').filter({ hasText: message }).count()).toBe(1);
  }
  for (const tab of [page, second]) {
    const notices = tab.getByRole('button', { name: 'Dismiss payment notification' });
    while (await notices.count()) await notices.first().click();
  }
  await page.reload(); await expect(page.getByRole('button', { name: 'Dismiss payment notification' })).toHaveCount(0);
  await page.getByRole('link', { name: /^Cart/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible(); await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
  await page.goBack(); await expect(page).toHaveURL(/\/$/); await page.goForward(); await expect(page).toHaveURL(/\/cart$/);
  await second.close();
});

test('reduced motion, live status and keyboard recovery/dismiss controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.install(); const flow = await scenario(page); await page.goto('/cart');
  await page.route('**/api/checkout/payment-attempts/' + purchase.attemptId + '/resume', route => route.fulfill({ json: {
    data: { ...terminal('DECLINED'), state: 'AWAITING_INPUT', clientSecret: 'pi_A_retry_secret_intercepted',
      request: { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD' } },
  } }));
  await expect(page.getByText(purchase.items[0].name)).toBeVisible(); flow.setRows([terminal('DECLINED')]);
  await page.clock.fastForward(15_001); const row = page.locator('[data-outcome="failure"]'); await expect(row).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Payment failed' })).toBeVisible();
  expect(await row.evaluate(element => getComputedStyle(element.parentElement!.parentElement!).animationName)).toBe('none');
  await page.clock.fastForward(451); await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
  // A's toast is keyboard dismissible on Cart; then B's outcome arrives on Home.
  const first = page.getByRole('button', { name: 'Dismiss payment notification' }); await first.focus(); await expect(first).toBeFocused();
  await page.keyboard.press('Enter'); await expect(first).toHaveCount(0);
  await shot(page, 'reduced-motion-cart-history');
  const second = terminal('PAID'); flow.setRows([{ ...second, attemptId: attemptB }]);
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  const close = page.getByRole('button', { name: 'Dismiss payment notification' }); await expect(close).toBeVisible();
  const toast = page.locator('li[data-state="open"]').filter({ has: close });
  expect(await toast.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await close.focus(); await expect(close).toBeFocused(); await page.keyboard.press('Enter'); await expect(close).toHaveCount(0);
});
