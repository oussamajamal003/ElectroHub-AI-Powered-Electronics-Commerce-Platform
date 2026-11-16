import { mkdirSync, readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { cart, confirmation, quote } from '../../src/features/checkout/fixtures';
import type { SavedPurchase } from '../../src/features/checkout/PaymentPurchases';
import type { CartData } from '../../src/features/cart/types';
import type { Shipping } from '../../src/features/checkout/types';

/*
 * Scenarios 2–6 customer journeys. EVIDENCE CATEGORY: real Chromium + the real production React build, with every
 * /api/** request and Stripe.js intercepted before navigation. These prove UI state, routing and request identity
 * only — not PostgreSQL, PaymentIntent, webhook or hosted-Stripe behaviour.
 */
const SHOTS = 'test-results/scenarios-2-6/shots'; mkdirSync(SHOTS, { recursive: true });
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'scenarios@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
const idA = 'aaaaaaaa-0000-4000-8000-00000000000a'; const idB = 'bbbbbbbb-0000-4000-8000-00000000000b'; const idC = 'cccccccc-0000-4000-8000-00000000000c';
const product = (id: string, slug: string, name: string, price: string, image: string) => ({ id, name, slug, price, description: `${name} for the scenario journey.`,
  compareAtPrice: null, discountPercent: null, averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE', stockStatus: 'IN_STOCK',
  availableQuantity: 10, purchasable: true, category: { id: 'category', name: 'Accessories', slug: 'accessories' }, brand: null, sku: `SKU-${slug}`, modelNumber: null,
  specifications: [], images: [{ id: `image-${slug}`, url: image, altText: name, isPrimary: true, sortOrder: 0 }] });
const productA = product('a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1', 'scenario-mouse', 'Lenovo Go USB-C Wireless Mouse', '49.00', '/images/catalog/variety/accessory-lenovo-mouse-01.jpg');
const productB = product('b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2', 'scenario-buds', 'Samsung Galaxy Buds2 Pro', '149.00', '/images/catalog/variety/galaxybuds-01.jpg');
type Product = typeof productA;
const lineFor = (item: Product, revision: string): CartData => ({ ...cart, revision, totalQuantity: 1, subtotal: item.price, total: item.price, canCheckout: true,
  items: [{ ...cart.items[0], id: `line-${item.slug}`, productId: item.id, quantity: 1, lineTotal: item.price,
    product: { name: item.name, price: item.price, category: 'Accessories', slug: item.slug, image: { url: item.images[0].url, altText: item.name } } }] });
const empty = (revision: string): CartData => ({ ...cart, revision, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false });
const cartA = lineFor(productA, 'a'.repeat(64)); const cartB = lineFor(productB, 'b'.repeat(64)); const buyNowRevision = 'c'.repeat(64);
const shipA: Shipping = { recipient: 'Avery Purchase-A', line1: '1 Alpha Road', line2: '', city: 'Alphaville', state: 'CA', postalCode: '90001', country: 'United States', phone: '+1 555 010 1000' };
const shipB: Shipping = { recipient: 'Blake Purchase-B', line1: '2 Beta Avenue', line2: 'Unit 9', city: 'Betatown', state: 'NY', postalCode: '10002', country: 'United States', phone: '+1 555 020 2000' };
const money = (value: number) => value.toFixed(2);
const quoteFor = (data: CartData) => ({ ...quote, cartRevision: data.revision, subtotal: data.subtotal, deliveryMethods: quote.deliveryMethods.map(method => ({ ...method,
  totals: { ...method.totals, subtotal: data.subtotal, total: money(Number(data.subtotal) + Number(method.price)) } })) });
type AState = 'PROCESSING' | 'DECLINED' | 'PAID' | 'ABORT' | 'UNKNOWN';
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

/** One mutable intercepted backend shared by every route the customer visits. */
async function world(page: Page, options: { reconcileA?: AState } = {}) {
  page.on('pageerror', error => errors.push(error.message));
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(user => { if (!sessionStorage.getItem('electrohub:cached-user')) sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)); }, user);
  await page.addInitScript({ content: readFileSync('tests/checkout/stripe-sdk.fixture.js', 'utf8') });
  await page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '// intercepted SDK fixture' }));
  const s = { cart: empty('0'.repeat(64)), rows: [] as SavedPurchase[], reconcileA: options.reconcileA ?? 'PROCESSING' as AState, aState: 'AWAITING_INPUT',
    aShipping: shipA, aDelivery: 'EXPRESS', aScope: 'CART_CHECKOUT', aTotal: '58.99', orders: [] as unknown[], reconcileGate: null as ReturnType<typeof gate> | null,
    statusFailure: false };
  const requests: { method: string; path: string; key?: string; body?: Record<string, unknown>; status?: number }[] = [];
  const aOutcome = (state = s.aState) => {
    const paid = state === 'PAID'; const declined = state === 'DECLINED';
    return { attemptId: idA, scope: s.aScope, state, classification: paid ? 'SUCCEEDED' : declined ? 'DECLINED' : state === 'UNKNOWN' ? 'UNKNOWN' : state === 'PROCESSING' ? 'PROCESSING' : 'NOT_SUBMITTED',
      submittedAt: state === 'AWAITING_INPUT' ? null : '2026-10-15T08:00:00.000Z', retryAllowed: declined, providerStatus: paid ? 'succeeded' : 'processing', failureCode: declined ? 'card_declined' : null,
      total: s.aTotal, currency: 'USD', orderReference: paid ? 'ORD-A' : null, committed: paid, cart: s.cart, recoveryRemainder: null, recoveryActive: false,
      cartRevision: s.aScope === 'BUY_NOW' ? buyNowRevision : cartA.revision, intentId: 'pi_A',
      confirmation: paid ? { ...confirmation, orderReference: 'ORD-A', paymentState: 'PAID', total: s.aTotal, items: [{ productId: productA.id, productName: productA.name, sku: productA.sku,
        imageUrl: productA.images[0].url, quantity: 1, unitPrice: '49.00', lineTotal: '49.00' }] } : null };
  };
  const row = (state: string, overrides: Partial<SavedPurchase> = {}): SavedPurchase => ({ attemptId: idA, scope: s.aScope, state,
    classification: state === 'PAID' ? 'SUCCEEDED' : state === 'DECLINED' ? 'DECLINED' : state === 'UNKNOWN' ? 'UNKNOWN' : 'PROCESSING',
    total: s.aTotal, currency: 'USD', pending: !['PAID', 'DECLINED'].includes(state), unread: ['PAID', 'DECLINED'].includes(state),
    orderReference: state === 'PAID' ? 'ORD-A' : null, submittedAt: '2026-10-15T08:00:00.000Z', retryAllowed: state === 'DECLINED',
    items: [{ name: productA.name, quantity: 1, imageUrl: productA.images[0].url }], ...overrides });
  await page.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname; const method = req.method();
    const body = method === 'POST' ? req.postDataJSON() ?? undefined : undefined;
    const record: (typeof requests)[number] = { method, path, key: req.headers()['idempotency-key'], body }; requests.push(record);
    const send = (data: unknown, status = 200) => { record.status = status; return route.fulfill({ status, json: data }); };
    if (path.startsWith('/api/auth/')) return path === '/api/auth/me' ? send({ user }) : send({ accessToken: 'intercepted-ui-test-token', user });
    if (path === '/api/cart') return send({ data: s.cart });
    if (path === '/api/cart/items' && method === 'POST') {
      const added = body?.productId === productA.id ? cartA : cartB; s.cart = added; return send({ data: s.cart });
    }
    if (path === '/api/wishlist') return send({ data: { items: [productA, productB].map(item => ({ productId: item.id, product: { ...item, primaryImage: item.images[0] }, availability: 'AVAILABLE' })), totalItems: 2 } });
    for (const item of [productA, productB]) {
      if (path === `/api/products/${item.slug}`) return send({ data: item });
      if (path.startsWith(`/api/products/${item.slug}/reviews`)) return send({ data: path.endsWith('/me') ? null : [], summary: { averageRating: null, reviewCount: 0 }, meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    }
    if (path === '/api/checkout') {
      const params = new URL(req.url()).searchParams;
      if (params.get('scope') === 'BUY_NOW') return send({ data: { ...quoteFor({ ...cartA, revision: buyNowRevision }), scope: 'BUY_NOW', summary: { ...cartA, revision: buyNowRevision } } });
      return send({ data: quoteFor(s.cart) });
    }
    if (path === '/api/checkout/payment-attempts' && method === 'GET') return send({ data: s.rows });
    if (path === '/api/checkout/payment-attempts' && method === 'POST') {
      const isA = body?.scope === 'BUY_NOW' || body?.expectedRevision === cartA.revision;
      const delivery = quoteFor(isA ? cartA : s.cart).deliveryMethods.find(item => item.id === body?.deliveryMethod);
      if (isA) {
        s.aScope = body?.scope === 'BUY_NOW' ? 'BUY_NOW' : 'CART_CHECKOUT'; s.aShipping = body?.shipping as Shipping; s.aDelivery = String(body?.deliveryMethod); s.aTotal = delivery?.totals.total ?? '49.00';
        return send({ data: { ...aOutcome('AWAITING_INPUT'), clientSecret: 'pi_A_secret_intercepted', replayed: false } }, 201);
      }
      return send({ data: { attemptId: idB, scope: 'CART_CHECKOUT', state: 'AWAITING_INPUT', classification: 'NOT_SUBMITTED', submittedAt: null, providerStatus: 'requires_payment_method',
        failureCode: null, total: delivery?.totals.total ?? s.cart.total, currency: 'USD', orderReference: null, committed: false, cart: s.cart, recoveryRemainder: null, recoveryActive: false,
        cartRevision: body?.expectedRevision, intentId: 'pi_B', confirmation: null, clientSecret: 'pi_B_secret_intercepted', replayed: false } }, 201);
    }
    if (path === `/api/checkout/payment-attempts/${idA}/submit`) {
      s.aState = 'PROCESSING'; s.rows = [row('PROCESSING')]; if (s.aScope === 'CART_CHECKOUT') s.cart = empty('d'.repeat(64));
      return send({ data: aOutcome() });
    }
    if (path === `/api/checkout/payment-attempts/${idA}/reconcile`) {
      if (s.reconcileGate) await s.reconcileGate.promise;
      if (s.reconcileA === 'ABORT') { s.aState = 'UNKNOWN'; s.rows = [row('UNKNOWN')]; record.status = 0; return route.abort('failed'); }
      s.aState = s.reconcileA; s.rows = [row(s.aState === 'PAID' ? 'PAID' : s.aState, s.aState === 'PAID' || s.aState === 'DECLINED' ? { unread: false } : {})];
      return send({ data: aOutcome() }, s.aState === 'PAID' ? 200 : 202);
    }
    if (path === `/api/checkout/payment-attempts/${idA}/resume`) {
      return send({ data: { ...aOutcome('AWAITING_INPUT'), submittedAt: '2026-10-15T08:00:00.000Z', retryAllowed: true, clientSecret: 'pi_A_retry_secret_intercepted', replayed: true,
        request: { shipping: s.aShipping, deliveryMethod: s.aDelivery, paymentMethod: 'CARD', ...(s.aScope === 'BUY_NOW' ? { scope: 'BUY_NOW' } : {}) },
        items: [{ name: productA.name, quantity: 1, imageUrl: productA.images[0].url }] } });
    }
    if (path === `/api/checkout/payment-attempts/${idC}/resume`) {
      return send({ data: { ...aOutcome('AWAITING_INPUT'), attemptId: idC, total: '1099.99', submittedAt: '2026-10-15T07:00:00.000Z', retryAllowed: true, clientSecret: 'pi_C_retry_secret_intercepted', replayed: true,
        request: { shipping: { ...shipB, recipient: 'Casey Purchase-C', city: 'Gammaport' }, deliveryMethod: 'OVERNIGHT', paymentMethod: 'CARD' },
        items: [{ name: 'Apple iPhone 15 Pro', quantity: 1, imageUrl: '/images/catalog/variety/apple-phone-generic-01.jpg' }] } });
    }
    if (/\/api\/checkout\/payment-attempts\/[^/]+\/read$/.test(path)) {
      const id = path.split('/').at(-2); s.rows = s.rows.map(item => item.attemptId === id ? { ...item, unread: false } : item); return send({ data: { ok: true } });
    }
    if (path === `/api/checkout/payment-attempts/${idA}`) {
      if (s.statusFailure) return send({ error: { code: 'PAYMENT_UNAVAILABLE', message: 'Unavailable' } }, 503);
      return send({ data: aOutcome() });
    }
    if (path === '/api/orders') {
      // Current contract (order.service.ts list): paginated { data, meta: { page, pageSize, total, totalPages } }.
      const params = new URL(req.url()).searchParams; const page = Number(params.get('page') ?? 1); const pageSize = Number(params.get('pageSize') ?? 10);
      return send({ data: s.orders.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total: s.orders.length, totalPages: Math.ceil(s.orders.length / pageSize) } });
    }
    if (path === '/api/orders/ORD-A/confirmation') return send({ data: aOutcome('PAID').confirmation });
    return send({ data: [], meta: { total: 0, page: 1, pageSize: 12, totalPages: 0 } });
  });
  return {
    s, requests, errors, row,
    /** Backend truth for A changes to a terminal state, as a webhook/worker would make it. */
    settleA(state: 'PAID' | 'DECLINED') {
      s.aState = state; s.rows = [row(state)];
      if (state === 'PAID') s.orders = [aOutcome('PAID').confirmation];
    },
    holdReconcile() { s.reconcileGate = gate(); return () => { const held = s.reconcileGate; s.reconcileGate = null; held?.release(); }; },
    setups: () => requests.filter(r => r.method === 'POST' && r.path === '/api/checkout/payment-attempts'),
    submits: () => requests.filter(r => r.path.endsWith('/submit')),
    confirms: () => page.evaluate(() => Reflect.get(window, '__stripeFixture').confirms as number),
    secrets: () => page.evaluate(() => Reflect.get(window, '__stripeFixture').clientSecrets as string[]),
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function shot(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage, animations: 'disabled' });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'horizontal overflow').toBeLessThanOrEqual(1);
}
async function inViewportWidth(page: Page, locator: Locator) {
  const box = await locator.boundingBox(); const width = page.viewportSize()!.width;
  expect(box, 'element rendered').not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}
async function fillShippingWith(page: Page, value: Shipping) {
  for (const [field, text] of Object.entries(value)) await page.locator(`#shipping-${field}`).fill(text);
}
async function fillCard(page: Page) {
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  const frame = page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]');
  await frame.getByLabel('Mock card number').fill('4242424242424242'); await frame.getByLabel('Mock expiry').fill('1230'); await frame.getByLabel('Mock security code').fill('123');
}
const cardValue = (page: Page) => page.frameLocator('iframe[title="Mock hosted card entry — intercepted UI test"]').getByLabel('Mock card number');
async function cartToReview(page: Page, value: Shipping, delivery: RegExp) {
  await fillShippingWith(page, value); await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('radio', { name: delivery }).check(); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
}
/** Product A → Add to Cart → Cart → Checkout A → Review → Place Order. */
async function submitCartA(page: Page, flow: World, holdProcessing = false) {
  await page.goto(`/products/${productA.slug}`);
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await page.getByRole('link', { name: 'Cart, 1 item' }).click();
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await cartToReview(page, shipA, /Express Delivery/);
  const release = holdProcessing ? flow.holdReconcile() : null;
  await page.getByRole('button', { name: /Place Order/ }).click();
  return release;
}
async function openProductBAndAdd(page: Page) {
  await page.getByRole('link', { name: /^Wishlist/ }).first().click();
  await page.getByRole('link', { name: new RegExp(productB.name) }).first().click();
  await expect(page.getByRole('heading', { name: productB.name })).toBeVisible();
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).click();
  await expect(page.getByText(`${productB.name} added to cart.`)).toBeVisible();
}
async function assertCartPendingAActiveB(page: Page) {
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toBeVisible();
  const pendingA = page.locator(`article[data-purchase="${idA}"]`);
  await expect(pendingA).toContainText(productA.name); await expect(pendingA.getByRole('link')).toHaveCount(0);
  await expect(pendingA.getByRole('button')).toHaveCount(0);
  const summary = page.getByRole('complementary', { name: 'Order Summary' });
  await expect(summary).toContainText('$149.00'); await expect(summary).not.toContainText('$49.00'); await expect(summary).not.toContainText('$58.99');
  await expect(summary).toContainText('Subtotal (1 item)');
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await expect(page.getByText(/^Pending purchases \(/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await noOverflow(page); await inViewportWidth(page, pendingA); await inViewportWidth(page, page.getByRole('button', { name: 'Proceed to Checkout' }));
}
const toastClose = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });
async function settledToast(page: Page) {
  const close = toastClose(page); await expect(close).toHaveCount(1);
  const toast = page.locator('li[data-state="open"]').filter({ has: close });
  await expect(toast).toBeVisible(); await page.mouse.move(0, 0);
  await toast.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  return toast;
}
function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const compact = [1024, 1280, 1366];
const heightFor = (width: number) => width < 768 ? 844 : width === 768 ? 1024 : width === 1024 ? 768 : width === 1280 ? 720 : width === 1366 ? 768 : width === 1440 ? 900 : 1080;
const all = [390, 768, 1024, 1280, 1366, 1440, 1920];

// ───────────────────────── Scenario 2 ─────────────────────────
for (const width of all) test(`S2 A processing → Home → add B → Checkout B isolated at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width < 768 ? 844 : width === 768 ? 1024 : width === 1024 ? 768 : width === 1280 ? 720 : width === 1366 ? 768 : width === 1440 ? 900 : 1080 });
  const flow = await world(page); const release = await submitCartA(page, flow, true);
  await expect(page.getByRole('heading', { name: 'Processing your order…' })).toBeVisible(); await shot(page, `s2-${width}-A-processing`, false);
  release!();
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try Again/ })).toHaveCount(0);
  await shot(page, `s2-${width}-A-checking`, false);
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click(); await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
  await openProductBAndAdd(page);
  await page.getByRole('link', { name: 'Cart, 1 item' }).click();
  await assertCartPendingAActiveB(page); await shot(page, `s2-${width}-cart-pending-A-active-B`);
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  for (const text of ['Checking your payment', 'Processing your order…', 'Your cart is empty', 'Payment Failed']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const summary = page.getByRole('complementary', { name: 'Order Summary' });
  await expect(summary).toContainText(productB.name); await expect(summary).not.toContainText(productA.name);
  // B's draft is its own: nothing of submitted A's address or Express delivery is carried into it.
  for (const field of Object.keys(shipB)) await expect(page.locator(`#shipping-${field}`)).toHaveValue('');
  await expect(summary).toContainText('Standard Delivery'); await expect(summary).toContainText('$149.00'); await expect(summary).not.toContainText('$158.99');
  await noOverflow(page); await shot(page, `s2-${width}-B-shipping`);
  await fillShippingWith(page, shipB); await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('radio', { name: /Overnight Delivery/ }).check(); await noOverflow(page); await shot(page, `s2-${width}-B-delivery`);
  await page.getByRole('button', { name: 'Continue to Payment' }).click(); await fillCard(page);
  await expect(page.getByRole('alert')).toHaveCount(0); await noOverflow(page);
  await inViewportWidth(page, page.getByRole('button', { name: 'Review Order' })); await shot(page, `s2-${width}-B-payment-ready`);
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
  await expect(page.getByText(shipB.recipient)).toBeVisible(); await expect(page.getByText(shipA.recipient)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Overnight Delivery' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Place Order · \$168\.99/ })).toBeEnabled();
  await expect(summary).toContainText('$168.99'); await expect(summary).not.toContainText(productA.name);
  await noOverflow(page); await inViewportWidth(page, page.getByRole('button', { name: /Place Order/ })); await shot(page, `s2-${width}-B-review`);
  // Identity: one A submission/confirmation, B owns a separate setup key, request and secret.
  const setups = flow.setups(); expect(setups).toHaveLength(2); expect(new Set(setups.map(r => r.key)).size).toBe(2);
  expect(setups[1].body).toMatchObject({ shipping: shipB, deliveryMethod: 'OVERNIGHT', expectedRevision: cartB.revision });
  expect(flow.submits()).toHaveLength(1); expect(await flow.confirms()).toBe(1);
  expect((await flow.secrets()).at(-1)).toBe('pi_B_secret_intercepted');
  expect(flow.requests.filter(r => r.path.includes(idB) && r.method === 'POST')).toHaveLength(0);
  expect(flow.errors).toEqual([]);
});

// ───────────────────────── Scenario 3 ─────────────────────────
async function scenario3Setup(page: Page, width: number) {
  await page.clock.install(); await page.setViewportSize({ width, height: heightFor(width) });
  const flow = await world(page); await submitCartA(page, flow);
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click(); await openProductBAndAdd(page);
  await page.getByRole('link', { name: 'Cart, 1 item' }).click(); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  return flow;
}
for (const width of [390, 768, ...compact, 1920]) test(`S3 A succeeds while B is on Payment — non-disruptive toast at ${width}px`, async ({ page }) => {
  const flow = await scenario3Setup(page, width);
  await fillShippingWith(page, shipB); await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('radio', { name: /Overnight Delivery/ }).check(); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await fillCard(page); const url = page.url(); const mounts = await page.evaluate(() => Reflect.get(window, '__stripeFixture').mounts as number);
  await shot(page, `s3-${width}-B-before-A-success`, false);
  flow.settleA('PAID'); await page.clock.fastForward(15_001);
  const toast = await settledToast(page);
  await expect(toast).toContainText('Payment successful! Your order has been confirmed.');
  const box = (await toast.boundingBox())!; const viewport = page.viewportSize()!;
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 40); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // Bottom-right from tablet up; on phones (stacked full-width actions) it sits just below the sticky header.
  if (width >= 768) expect(box.y + box.height).toBeGreaterThan(viewport.height - 40);
  else { expect(box.y).toBeGreaterThanOrEqual(56); expect(box.y).toBeLessThan(140); }
  await shot(page, `s3-${width}-toast-over-B`, false);
  // B is untouched: same URL/step, same mounted secure entry with typed values, same totals, no focus theft.
  expect(page.url()).toBe(url); await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
  await expect(cardValue(page)).toHaveValue('4242424242424242');
  expect(await page.evaluate(() => Reflect.get(window, '__stripeFixture').mounts as number)).toBe(mounts);
  await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText('$168.99');
  expect(await page.evaluate(() => document.activeElement?.closest('[data-state="open"]') === null)).toBe(true);
  const cta = page.getByRole('button', { name: 'Review Order' }); await cta.scrollIntoViewIfNeeded();
  const ctaBox = (await cta.boundingBox())!; const toastBox = (await toast.boundingBox())!;
  expect(intersects(ctaBox, toastBox), `toast ${JSON.stringify(toastBox)} must not cover Review Order ${JSON.stringify(ctaBox)}`).toBe(false);
  await page.clock.fastForward(5_001); await expect(toastClose(page)).toHaveCount(0);
  // Refetch/remount never repeats the same terminal toast.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await page.clock.fastForward(16_000);
  await expect(toastClose(page)).toHaveCount(0); await shot(page, `s3-${width}-B-after-toast`, false);
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByText(shipB.recipient)).toBeVisible(); await expect(page.getByRole('button', { name: /Place Order · \$168\.99/ })).toBeEnabled();
  expect(flow.setups()).toHaveLength(2); expect(flow.submits()).toHaveLength(1);
  // A is available in Orders as Paid.
  await page.goto('/orders'); const order = page.getByRole('article').filter({ hasText: 'ORD-A' });
  await expect(order).toBeVisible(); await expect(order).toContainText(productA.name); await expect(order.getByText('Paid', { exact: true })).toBeVisible();
  await expect(order).toContainText('$58.99'); await expect(order.getByRole('link', { name: 'View order ORD-A' })).toBeVisible();
  await noOverflow(page); await shot(page, `s3-${width}-orders-A-paid`);
  expect(flow.errors).toEqual([]);
});
for (const step of ['shipping', 'review'] as const) test(`S3 A success while B ${step} is in progress leaves B intact at 1280px`, async ({ page }) => {
  const flow = await scenario3Setup(page, 1280);
  if (step === 'shipping') {
    await page.locator('#shipping-recipient').fill(shipB.recipient); await page.locator('#shipping-line1').fill(shipB.line1);
    await page.locator('#shipping-line1').focus();
  } else {
    await fillShippingWith(page, shipB); await page.getByRole('button', { name: 'Continue to Delivery' }).click();
    await page.getByRole('radio', { name: /Overnight Delivery/ }).check(); await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await fillCard(page); await page.getByRole('button', { name: 'Review Order' }).click();
  }
  const url = page.url(); flow.settleA('PAID'); await page.clock.fastForward(15_001); await settledToast(page);
  expect(page.url()).toBe(url);
  if (step === 'shipping') {
    await expect(page.locator('#shipping-recipient')).toHaveValue(shipB.recipient); await expect(page.locator('#shipping-line1')).toBeFocused();
  } else {
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible(); await expect(page.getByRole('button', { name: /Place Order · \$168\.99/ })).toBeEnabled();
  }
  await shot(page, `s3-1280-toast-during-${step}`, false);
  await toastClose(page).click(); await expect(toastClose(page)).toHaveCount(0);
  expect(flow.requests.filter(r => r.path.endsWith(`${idA}/read`))).toHaveLength(1);
  expect(flow.errors).toEqual([]);
});

// ───────────────────────── Scenario 4 ─────────────────────────
for (const width of [390, ...compact, 1920]) test(`S4 declined A → Payment Failed → Try Again restores A's own saved checkout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width >= 1366 ? 768 : width >= 1280 ? 720 : width >= 1024 ? 768 : 844 });
  const flow = await world(page, { reconcileA: 'DECLINED' });
  await page.addInitScript(() => { Reflect.get(window, '__stripeFixture').behavior = 'decline'; });
  await submitCartA(page, flow);
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(1);
  await noOverflow(page); await shot(page, `s4-${width}-payment-failed`, false);
  // No toast duplicates what Payment Failed already shows.
  await expect(toastClose(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page).toHaveURL(/\/checkout\?step=payment$/);
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  const summary = page.getByRole('complementary', { name: 'Order Summary' });
  await expect(summary).toContainText(productA.name); await expect(summary).toContainText('$58.99'); await expect(summary).toContainText(shipA.recipient);
  await expect(summary).toContainText('Express');
  await expect(page.getByRole('alert')).toHaveCount(0); await noOverflow(page); await shot(page, `s4-${width}-retry-payment-context`);
  await page.getByRole('button', { name: 'Back' }).click(); await expect(page.getByRole('heading', { name: 'Express Delivery' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click(); await expect(page.getByText(shipA.line1).first()).toBeVisible();
  await noOverflow(page); await shot(page, `s4-${width}-retry-restored-shipping`);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click(); await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await fillCard(page); await shot(page, `s4-${width}-retry-secure-entry`);
  // Try Again never re-submits; only resume of the same attempt occurred, no new setup.
  expect(flow.requests.filter(r => r.path.endsWith(`${idA}/resume`))).toHaveLength(1);
  expect(flow.setups()).toHaveLength(1); expect(flow.submits()).toHaveLength(1); expect(await flow.confirms()).toBe(1);
  expect((await flow.secrets()).at(-1)).toBe('pi_A_retry_secret_intercepted');
  expect(flow.errors).toEqual([]);
});
test('S4 failed A shown in Cart beside active B; two failed purchases keep separate contexts', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const flow = await world(page); flow.s.cart = cartB; flow.s.aTotal = '58.99';
  flow.s.rows = [flow.row('DECLINED', { unread: false }), flow.row('DECLINED', { attemptId: idC, unread: false, total: '1099.99', items: [{ name: 'Apple iPhone 15 Pro', quantity: 1, imageUrl: '/images/catalog/variety/apple-phone-generic-01.jpg' }] })];
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText('$149.00');
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible(); await noOverflow(page); await shot(page, 's4-1280-cart-failed-A-C-active-B');
  await page.locator(`article[data-purchase="${idC}"]`).getByRole('link', { name: /^Try Again/ }).click();
  const summary = page.getByRole('complementary', { name: 'Order Summary' });
  await expect(summary).toContainText('Apple iPhone 15 Pro'); await expect(summary).toContainText('Casey Purchase-C'); await expect(summary).not.toContainText(productA.name);
  await page.goBack(); await page.locator(`article[data-purchase="${idA}"]`).getByRole('link', { name: /^Try Again/ }).click();
  await expect(summary).toContainText(productA.name); await expect(summary).toContainText(shipA.recipient); await expect(summary).not.toContainText('Casey Purchase-C');
  expect((await flow.secrets()).at(-1)).toBe('pi_A_retry_secret_intercepted');
  await page.getByRole('link', { name: 'Cart, 1 item' }).click(); await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText('$149.00');
  expect(flow.requests.filter(r => r.path.startsWith('/api/cart') && r.method !== 'GET')).toHaveLength(0);
  expect(flow.errors).toEqual([]);
});

// ───────────────────────── Scenario 5 ─────────────────────────
for (const width of [390, ...compact]) test(`S5 lost reconcile response → truthful UNKNOWN, no resubmission, later verified result at ${width}px`, async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width, height: width >= 1366 ? 768 : width >= 1280 ? 720 : width >= 1024 ? 768 : 844 });
  const flow = await world(page, { reconcileA: 'ABORT' }); await submitCartA(page, flow);
  await expect(page.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
  for (const text of ['Payment Failed', 'Order Confirmed!']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Try Again|Place Order|Pay/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled(); await noOverflow(page); await shot(page, `s5-${width}-unconfirmed`, false);
  // A check that fails again ends its own loading state and stays truthful.
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
  // Navigate Home → Cart: pending, not failed; no retry.
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click(); await page.getByRole('link', { name: /^Cart, / }).click();
  const card = page.locator(`article[data-purchase="${idA}"]`); await expect(card).toContainText('Awaiting confirmation');
  await expect(card.getByRole('link')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Failed payments' })).toHaveCount(0);
  await noOverflow(page); await shot(page, `s5-${width}-cart-unknown`);
  // The in-page SDK fixture counter resets on reload, so read it first; network records persist across it.
  expect(await flow.confirms()).toBe(1);
  await page.reload(); await expect(card).toContainText('Awaiting confirmation');
  expect(flow.setups()).toHaveLength(1); expect(flow.submits()).toHaveLength(1);
  // Backend later verifies PAID: card leaves, toast once, Orders shows it.
  // The 450 ms inline outcome frame is covered by the Scenario 1 suite; here assert the settled end state.
  flow.settleA('PAID'); await page.clock.fastForward(15_001); await page.clock.fastForward(451);
  await expect(page.getByRole('heading', { name: 'Pending purchases' })).toHaveCount(0);
  await settledToast(page); await shot(page, `s5-${width}-later-paid`, false);
  expect(flow.setups()).toHaveLength(1); expect(flow.submits()).toHaveLength(1);
  expect(flow.errors.filter(text => !/net::ERR_FAILED/.test(text))).toEqual([]);
});
test('S5 UNKNOWN later verified DECLINED while on Home → failure toast, Cart failed card, no full-page failure', async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 1280, height: 720 });
  const flow = await world(page, { reconcileA: 'ABORT' }); await submitCartA(page, flow);
  await expect(page.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click();
  flow.settleA('DECLINED'); await page.clock.fastForward(15_001);
  // Hovering pauses the toast's five-second timer (Radix), as a customer reading it would.
  const toast = await settledToast(page); await toast.hover(); await expect(toast).toContainText('Payment was not completed');
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0); await expect(page).toHaveURL(/\/$/);
  await shot(page, 's5-1280-later-declined-toast', false);
  await toast.getByRole('link').click(); await expect(page.getByRole('heading', { name: 'Failed payments' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Try Again/ })).toHaveCount(1);
  expect(flow.submits()).toHaveLength(1);
});

// ───────────────────────── Scenario 6 ─────────────────────────
for (const outcome of ['PAID', 'DECLINED', 'PENDING'] as const) for (const width of outcome === 'PAID' ? [390, ...compact, 1920] : [1280]) test(`S6 Buy Now A stays independent of Cart B (${outcome}) at ${width}px`, async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width, height: width >= 1366 ? 768 : width >= 1280 ? 720 : width >= 1024 ? 768 : 844 });
  const flow = await world(page); await page.goto(`/products/${productA.slug}`);
  await expect(page.getByRole('button', { name: 'Buy Now' })).toBeVisible(); await noOverflow(page); await shot(page, `s6-${width}-product-A`, false);
  await page.getByRole('button', { name: 'Buy Now' }).click(); await expect(page).toHaveURL(/\/checkout\/buy-now/);
  await expect(page.getByText('Buy Now Checkout')).toBeVisible();
  await cartToReview(page, shipA, /Express Delivery/); await shot(page, `s6-${width}-buy-now-A-review`);
  await page.getByRole('button', { name: /Place Order/ }).click();
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  expect(flow.setups()[0].body).toMatchObject({ scope: 'BUY_NOW', buyNow: { productId: productA.id, quantity: 1 } });
  await page.getByRole('link', { name: 'ElectroHub — Home' }).click(); await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
  await openProductBAndAdd(page); await page.getByRole('link', { name: 'Cart, 1 item' }).click();
  await assertCartPendingAActiveB(page); await shot(page, `s6-${width}-A-pending-B-cart`);
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
  await expect(page.getByText('Buy Now Checkout')).toHaveCount(0);
  for (const field of Object.keys(shipB)) await expect(page.locator(`#shipping-${field}`)).toHaveValue('');
  await fillShippingWith(page, shipB); await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('radio', { name: /Overnight Delivery/ }).check(); await page.getByRole('button', { name: 'Continue to Payment' }).click(); await fillCard(page);
  await shot(page, `s6-${width}-checkout-B`);
  const url = page.url();
  if (outcome !== 'PENDING') flow.settleA(outcome);
  await page.clock.fastForward(15_001);
  if (outcome === 'PENDING') await expect(toastClose(page)).toHaveCount(0);
  else {
    const toast = await settledToast(page); await expect(toast).toContainText(outcome === 'PAID' ? 'Payment successful' : 'Payment was not completed');
    await shot(page, `s6-${width}-late-A-${outcome}-over-B`, false);
  }
  expect(page.url()).toBe(url); await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
  await expect(cardValue(page)).toHaveValue('4242424242424242');
  await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText('$168.99');
  await expect(page.getByRole('complementary', { name: 'Order Summary' })).not.toContainText(productA.name);
  expect((await flow.secrets()).at(-1)).toBe('pi_B_secret_intercepted');
  expect(flow.setups()).toHaveLength(2); expect(flow.setups()[1].body?.scope).toBeUndefined();
  expect(flow.submits()).toHaveLength(1); expect(await flow.confirms()).toBe(1);
  expect(flow.errors).toEqual([]);
});

test('S3 acknowledgement save failure is a dismissible notice, never raw text pushed above Checkout B', async ({ page }) => {
  const flow = await scenario3Setup(page, 1280);
  await page.route('**/api/checkout/payment-attempts/*/read', route => route.fulfill({ status: 503, json: { error: { code: 'PAYMENT_UNAVAILABLE', message: 'Unavailable' } } }));
  await fillShippingWith(page, shipB);
  const heading = page.getByRole('heading', { name: 'Shipping Information' });
  // Document-relative geometry, sampled only once stable: immune to the scroll fill() performs, sensitive to real
  // layout shift (a 40px shim above the heading fails it). Contributed by the Scenario 1 owner, 2026-10-15.
  const geometry = () => heading.evaluate(element => ({ top: Math.round(element.getBoundingClientRect().top + window.scrollY), scrollY: Math.round(window.scrollY) }));
  const stable = async () => {
    let previous = await geometry();
    await expect.poll(async () => { const next = await geometry(); const same = next.top === previous.top && next.scrollY === previous.scrollY; previous = next; return same; }, { intervals: [250, 250, 250] }).toBe(true);
    return previous;
  };
  const summary = page.getByRole('complementary', { name: 'Order Summary' });
  const fields = () => Promise.all(Object.keys(shipB).map(field => page.locator(`#shipping-${field}`).inputValue()));
  const before = await stable(); const url = page.url(); const totals = await summary.innerText(); const values = await fields();
  flow.settleA('PAID'); await page.clock.fastForward(15_001); await settledToast(page); await toastClose(page).click();
  const notice = page.getByRole('button', { name: 'Dismiss acknowledgement notice' }); await expect(notice).toBeVisible();
  expect(await stable()).toEqual(before);
  expect(page.url()).toBe(url); await expect(heading).toBeVisible();
  expect(await fields()).toEqual(values); expect(await summary.innerText()).toBe(totals);
  await shot(page, 's3-1280-ack-failure-notice', false);
  await notice.click(); await expect(notice).toHaveCount(0);
  expect(await stable()).toEqual(before);
  expect(flow.submits()).toHaveLength(1);
});
for (const width of [390, 1024, 1280]) test(`Orders history states (loading → list, empty) at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: heightFor(width) }); const flow = await world(page);
  flow.settleA('PAID'); flow.s.orders = [flow.s.orders[0], { ...(flow.s.orders[0] as object), orderReference: 'ORD-B', paymentState: 'PENDING', createdAt: '2026-10-14T09:00:00Z' }];
  await page.goto('/orders'); await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2); await expect(page.getByRole('article').filter({ hasText: 'ORD-B' }).getByText('Pending', { exact: true })).toBeVisible();
  await noOverflow(page); await shot(page, `orders-${width}-list`);
  flow.s.orders = []; await page.reload(); await expect(page.getByText('You have no orders yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore Products' })).toBeVisible(); await noOverflow(page); await shot(page, `orders-${width}-empty`, false);
});
