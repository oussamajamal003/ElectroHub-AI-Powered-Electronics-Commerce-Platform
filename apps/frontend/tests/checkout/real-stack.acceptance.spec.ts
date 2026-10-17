import { expect, test, type Frame, type Page, type Request } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Task 03.6 REAL-STACK acceptance (evidence category F). Real Vite frontend -> real Express backend -> disposable PostgreSQL
// 17 -> Stripe Test Mode via the real hosted Payment Element. NOTHING is intercepted: no page.route, no Stripe.js stub.
// Requires an operator-started stack (see the Task 03.6 real-acceptance handoff) and REAL_STACK_FIXTURES (disposable
// customers/products). Official Stripe test cards only.
const fixturesFile = process.env.REAL_STACK_FIXTURES ?? '';
test.skip(!fixturesFile, 'Real-stack acceptance needs a running stack and REAL_STACK_FIXTURES');
type Customer = { key: string; id: string; email: string; password: string };
const fixtures = fixturesFile ? JSON.parse(readFileSync(fixturesFile, 'utf8')) as { run: string; customers: Customer[]; products: Record<string, string> } : null;
const evidenceDir = process.env.REAL_STACK_EVIDENCE_DIR ?? 'test-evidence/real-stack';
mkdirSync(evidenceDir, { recursive: true });
const record = (label: string, value: object) => appendFileSync(`${evidenceDir}/evidence.jsonl`, JSON.stringify({ at: new Date().toISOString(), label, ...value }) + '\n');
// REAL_STACK_ROUND selects a fresh set of disposable customers (e.g. dave2) so a full rerun starts from clean state.
const roundKey = (key: string) => `${key}${process.env.REAL_STACK_ROUND ?? ''}`;
const customer = (key: string) => { const found = fixtures!.customers.find(c => c.key === roundKey(key)); if (!found) throw new Error(`Missing fixture customer ${roundKey(key)}`); return found; };
const slug = (key: 'a' | 'b' | 'c') => `acceptance-${fixtures!.run}-${key}`;
const CARD_OK = '4242424242424242';
const CARD_DECLINE = '4000000000000002';
const CARD_3DS = '4000002760003184'; // always requires 3DS authentication

const submissionsOf = new WeakMap<object, string[]>();
/** Every application API call is recorded (method, path, status, request id); bodies are never stored. */
function trackApi(page: Page) {
  const submissions: string[] = [];
  const calls: Array<{ method: string; path: string; status?: number; requestId?: string | null; at: number; cartQuantity?: number; purchases?: string[] }> = [];
  page.on('response', async response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    const entry: (typeof calls)[number] = { method: response.request().method(), path: url.pathname, status: response.status(), requestId: response.headers()['x-request-id'] ?? null, at: Date.now() };
    calls.push(entry);
    // Only non-sensitive projections are kept: the active Cart quantity and each purchase's state/unread flag.
    if (entry.method === 'GET' && url.pathname === '/api/cart') entry.cartQuantity = (await response.json().catch(() => null))?.data?.totalQuantity;
    if (entry.method === 'GET' && url.pathname === '/api/checkout/payment-attempts') {
      const list = (await response.json().catch(() => null))?.data;
      entry.purchases = Array.isArray(list) ? list.map((p: { attemptId: string; state: string; classification?: string; unread?: boolean }) => `${p.attemptId.slice(0, 8)}:${p.state}:${p.classification ?? ''}:${p.unread ? 'unread' : 'read'}`) : undefined;
    }
  });
  // The submitted identity is captured when the request leaves the browser, so a lost or aborted response cannot hide it.
  page.on('request', (request: Request) => {
    const id = new URL(request.url()).pathname.match(/payment-attempts\/([0-9a-f-]{36})\/submit$/)?.[1];
    if (id) submissions.push(id);
  });
  page.on('requestfailed', (request: Request) => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) calls.push({ method: request.method(), path: url.pathname, at: Date.now() }); });
  submissionsOf.set(calls, submissions);
  return calls;
}
async function signIn(page: Page, who: Customer) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('you@example.com').fill(who.email);
  await dialog.getByPlaceholder('Enter your password').fill(who.password);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
}
async function addProduct(page: Page, key: 'a' | 'b' | 'c', mode: 'cart' | 'buy-now' = 'cart') {
  await page.goto(`/products/${slug(key)}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const added = page.waitForResponse(r => r.url().includes('/api/cart/items') && r.request().method() === 'POST');
  await page.getByRole('button', { name: mode === 'cart' ? 'Add to Cart' : 'Buy Now' }).first().click();
  expect((await added).status()).toBe(201);
}
async function cartBadge(page: Page) { return page.getByRole('link', { name: /^Cart, / }).getAttribute('aria-label'); }
async function shippingAndDelivery(page: Page) {
  await expect(page.locator('#shipping-recipient')).toBeVisible();
  for (const [field, value] of Object.entries({ recipient: 'Acceptance Shopper', line1: '1 Test Avenue', city: 'Test City', postalCode: '12345', phone: '+1 555 010 2000' })) {
    await page.locator(`#shipping-${field}`).fill(value);
  }
  const country = page.locator('#shipping-country');
  if (await country.evaluate(node => node.tagName === 'SELECT')) await country.selectOption({ label: 'United States' }); else await country.fill('United States');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('radio', { name: /Standard Delivery/ }).check();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
}
async function stripeCardFrame(page: Page): Promise<Frame> {
  // The real Payment Element renders inside js.stripe.com iframes; pick the one that hosts the card number field.
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const frame of page.frames()) {
      if (!frame.url().includes('js.stripe.com')) continue;
      if (await frame.getByLabel('Card number', { exact: true }).count().catch(() => 0)) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Real Stripe Payment Element card field did not render');
}
async function enterCard(page: Page, number: string) {
  const frame = await stripeCardFrame(page);
  await frame.getByLabel('Card number', { exact: true }).fill(number);
  await frame.getByLabel(/Expiration/).fill('1230');
  await frame.getByLabel('Security code', { exact: true }).fill('123');
  const zip = frame.getByLabel(/ZIP|Postal/);
  if (await zip.count()) await zip.fill('12345');
}
async function reviewAndPlace(page: Page) {
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
  await page.getByRole('button', { name: /Place Order/ }).click();
}
async function shot(page: Page, name: string) { await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true }); }
async function stripeLoaded(page: Page) { return page.frames().some(frame => frame.url().startsWith('https://js.stripe.com/')); }

test.describe.configure({ mode: 'serial' });

test('S1a — real hosted card entry, Place Order, processing screen, authoritative Paid result', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const api = trackApi(page); const dave = customer(process.env.S1A_CUSTOMER ?? 'dave');
  await signIn(page, dave); await addProduct(page, 'a');
  await page.goto('/cart'); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await shippingAndDelivery(page); await enterCard(page, CARD_OK);
  expect(await stripeLoaded(page)).toBe(true);
  await shot(page, 's1a-payment-1366');
  const submitResponse = page.waitForResponse(r => /\/payment-attempts\/[^/]+\/submit$/.test(r.url()));
  await reviewAndPlace(page);
  await submitResponse;
  const submitAt = Date.now(); let badgeAfterSubmit: string | null = null; let badgeSettledMs: number | null = null;
  while (Date.now() - submitAt < 5000) { badgeAfterSubmit = await cartBadge(page); if (badgeAfterSubmit === 'Cart, 0 items') { badgeSettledMs = Date.now() - submitAt; break; } await page.waitForTimeout(100); }
  const stillProcessingAtSettle = await page.getByRole('heading', { name: /Processing|Checking your payment/ }).count();
  const processing = page.getByRole('heading', { name: /Processing|Checking your payment/ });
  const sawProcessing = await processing.waitFor({ timeout: 10000 }).then(() => true, () => false);
  const badgeOnProcessing = sawProcessing ? await cartBadge(page) : null;
  const serverCartOnProcessing = (dbTool('cart', dave.key).rows as Array<{ quantity: number }>).reduce((sum, row) => sum + row.quantity, 0);
  const lastCartResponse = api.filter(c => c.cartQuantity !== undefined).at(-1)?.cartQuantity;
  if (sawProcessing) await shot(page, 's1a-processing-1366');
  const headings = async () => (await page.getByRole('heading').allInnerTexts()).join(' | ');
  await expect(page.getByRole('heading', { name: /Order Confirmed|Thank you|Payment Successful|Confirmed/i })).toBeVisible({ timeout: 90000 });
  await shot(page, 's1a-confirmed-1366');
  const t0 = api.find(c => c.path.endsWith('/submit'))?.at ?? 0;
  const timeline = api.filter(c => c.path.endsWith('/submit') || c.path === '/api/cart' || c.path.endsWith('/reconcile')).map(c => `${c.at - t0}ms ${c.method} ${c.path.replace(/[0-9a-f-]{36}/g, ':id')} ${c.status ?? 'FAILED'}${c.cartQuantity !== undefined ? ' qty=' + c.cartQuantity : ''}`);
  record('S1a', { customer: dave.key, badgeAfterSubmit, badgeSettledMs, stillProcessingAtSettle, timeline, badgeOnProcessing, serverCartOnProcessing, lastCartResponseOnProcessing: lastCartResponse, badgeAfter: await cartBadge(page), sawProcessing, finalHeadings: await headings(), url: page.url(),
    api: api.filter(c => /payment-attempts|checkout|cart/.test(c.path)).map(c => `${c.method} ${c.path.replace(/[0-9a-f-]{36}/g, ':id')} ${c.status ?? 'FAILED'} ${c.requestId ?? ''}`) });
});

/** Provider-side completion of a saved purchase's SAME PaymentIntent (as if authentication finished elsewhere); never a new intent. */
async function completeAtProvider(attemptId: string, paymentMethod: string) {
  const { default: Stripe } = await import('stripe');
  const key = process.env.REAL_STACK_STRIPE_TEST_KEY ?? '';
  if (!key.startsWith('sk_test_')) throw new Error('Stripe Test Mode key required for provider-side completion');
  const stripe = new Stripe(key);
  for await (const intent of stripe.paymentIntents.list({ limit: 50, created: { gte: Math.floor(Date.now() / 1000) - 3600 } })) {
    if (intent.metadata?.attemptId !== attemptId) continue;
    const confirmed = await stripe.paymentIntents.confirm(intent.id, { payment_method: paymentMethod, return_url: 'http://localhost:5180/checkout' });
    return { intentStatus: confirmed.status, livemode: confirmed.livemode };
  }
  throw new Error('PaymentIntent for the saved purchase not found');
}
const toasts = (page: Page) => page.getByRole('button', { name: 'Dismiss payment notification' });
const submittedAttempt = (api: ReturnType<typeof trackApi>) => submissionsOf.get(api)?.at(-1) ?? '';
async function waitForChallenge(page: Page) {
  // Up to 60 s: on a loaded workstation submit + Stripe confirmation can take >10 s before the challenge opens.
  for (let i = 0; i < 120; i++) { if (page.frames().some(f => /three_d_secure|3ds|challenge|authenticate/i.test(f.url()))) return true; await page.waitForTimeout(500); }
  return false;
}

test('S1b/S2/S3 — pending A, Cart B active, late A success while Checkout B is open', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const api = trackApi(page); const erin = customer('erin');
  await signIn(page, erin); await addProduct(page, 'a');
  await page.goto('/cart'); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await shippingAndDelivery(page); await enterCard(page, CARD_3DS);
  await reviewAndPlace(page);
  // Real Stripe 3DS challenge opens; it is deliberately left unanswered, so A stays unresolved at the provider.
  const challenge = await waitForChallenge(page);
  await shot(page, 's1b-3ds-challenge-1366');
  const attemptA = submittedAttempt(api);
  expect(attemptA).not.toBe('');
  // Leave safely for Cart through in-app navigation.
  await page.getByRole('link', { name: /^Cart, / }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText('Pending purchases')).toBeVisible({ timeout: 30000 });
  const badgeWhilePending = await cartBadge(page);
  await shot(page, 's1b-cart-pending-a-1366');
  const continuePayment = await page.getByRole('button', { name: /Continue Payment/i }).count();
  record('S1b.pending', { attemptA: attemptA.slice(0, 8), challengeShown: challenge, badgeWhilePending, continuePaymentButtons: continuePayment,
    lastCart: api.filter(c => c.cartQuantity !== undefined).at(-1), lastPurchases: api.filter(c => c.purchases).at(-1)?.purchases });
  expect(continuePayment).toBe(0);
  expect(badgeWhilePending).toBe('Cart, 0 items');

  // Scenario 2: add B while A is unresolved.
  await addProduct(page, 'b');
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Acceptance Charger B' })).toBeVisible();
  await expect(page.getByText('Pending purchases')).toBeVisible();
  const badgeWithB = await cartBadge(page);
  await shot(page, 's2-cart-b-active-a-pending-1366');
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.locator('#shipping-recipient')).toBeVisible();
  const cleanShipping = await page.locator('#shipping-recipient').inputValue();
  const cleanLine1 = await page.locator('#shipping-line1').inputValue();
  await shippingAndDelivery(page);
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeVisible();
  await enterCard(page, CARD_OK);
  await shot(page, 's2-checkout-b-payment-1366');
  record('S2', { badgeWithB, cleanShipping, cleanLine1, totalBVisible: await page.getByText('$19.99').count(), totalIncludesA: await page.getByText('$69.98').count(),
    setups: api.filter(c => c.method === 'POST' && c.path === '/api/checkout/payment-attempts').map(c => c.status) });
  expect(badgeWithB).toBe('Cart, 1 item');
  expect(cleanShipping).toBe(''); expect(cleanLine1).toBe('');

  // Scenario 3: A succeeds late at the provider while Checkout B stays open on its Payment step.
  const before = { url: page.url(), headings: await page.getByRole('heading').allInnerTexts() };
  const toastsBefore = await toasts(page).count();
  const completion = await completeAtProvider(attemptA, 'pm_card_visa');
  await expect(toasts(page)).toHaveCount(toastsBefore + 1, { timeout: 60000 });
  const shownAt = Date.now();
  const toastText = await page.locator('[role="status"], [role="alert"]').allInnerTexts();
  await shot(page, 's3-late-success-toast-on-checkout-b-1366');
  const after = { url: page.url(), headings: await page.getByRole('heading').allInnerTexts() };
  const reviewStillThere = await page.getByRole('button', { name: 'Review Order' }).isVisible();
  const stripeStillMounted = await stripeLoaded(page);
  const badgeAfter = await cartBadge(page);
  await expect(toasts(page)).toHaveCount(toastsBefore, { timeout: 15000 });
  const dismissedAfterMs = Date.now() - shownAt;
  record('S3', { completion, toastText: toastText.filter(Boolean).slice(0, 4), before, after, reviewStillThere, stripeStillMounted, badgeAfter, dismissedAfterMs,
    reads: api.filter(c => c.path.endsWith('/read')).map(c => `${c.path.slice(-50)} ${c.status ?? 'FAILED'}`) });
  expect(after.url).toBe(before.url); expect(reviewStillThere).toBe(true); expect(stripeStillMounted).toBe(true); expect(badgeAfter).toBe('Cart, 1 item');

  // B is paid normally; Orders then shows both real orders.
  await reviewAndPlace(page);
  await expect(page.getByRole('heading', { name: /Order Confirmed/i })).toBeVisible({ timeout: 90000 });
  await shot(page, 's3-b-confirmed-1366');
  await page.goto('/orders');
  await expect(page.getByText(/Acceptance Headphones A/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, 's3-orders-1366');
  record('S3.end', { api: api.filter(c => /payment-attempts/.test(c.path) && c.method !== 'GET').map(c => `${c.method} ${c.path.replace(/[0-9a-f-]{36}/g, ':id')} ${c.status ?? 'FAILED'}`) });
});

test('S1c — returning to Checkout while purchase A is unresolved never shows an empty checkout or a second payment', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const api = trackApi(page); const who = customer(process.env.S1C_CUSTOMER ?? 'rita');
  await signIn(page, who); await addProduct(page, 'a');
  await page.goto('/cart'); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await shippingAndDelivery(page); await enterCard(page, CARD_3DS); await reviewAndPlace(page);
  await waitForChallenge(page);
  const attemptA = submittedAttempt(api) || (dbTool('purchases', who.key).rows as Array<{ id: string; state: string }>).filter(row => !['PAID', 'DECLINED', 'CANCELED'].includes(row.state)).at(-1)?.id || '';
  await page.goto('/checkout');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  const headings = await page.getByRole('heading').allInnerTexts();
  const body = await page.locator('main').innerText().catch(() => '');
  await shot(page, 's1c-return-to-checkout-1366');
  const placeOrder = await page.getByRole('button', { name: /Place Order/ }).count();
  const continuePayment = await page.getByRole('button', { name: /Continue Payment/i }).count();
  const cardEntry = await stripeLoaded(page);
  const setups = api.filter(c => c.method === 'POST' && c.path === '/api/checkout/payment-attempts').length;
  record('S1c', { attemptA: attemptA.slice(0, 8), url: page.url(), headings: headings.slice(0, 4), mentionsPending: /pending|processing|being processed|unresolved|saved purchase/i.test(body),
    showsEmptyCart: /Your cart is empty/i.test(headings.join(' ')), placeOrder, continuePayment, cardEntry, setups, server: dbTool('attempt', attemptA) });
  // Returning to A itself: open it from its pending card in Cart.
  await page.goto('/cart');
  await expect(page.getByText('Pending purchases')).toBeVisible({ timeout: 30000 });
  const cardLinks = await page.getByRole('link').evaluateAll(nodes => nodes.map(n => `${(n.textContent ?? '').trim()}=>${n.getAttribute('href')}`).filter(l => /payment-status|purchase=|checkout/.test(l)));
  const statusLink = page.locator(`a[href*="${attemptA}"]`).first();
  let aView: string[] = [];
  if (await statusLink.count()) { await statusLink.click(); await page.waitForTimeout(3000); aView = await page.getByRole('heading').allInnerTexts(); await shot(page, 's1c-open-a-from-cart-1366'); }
  record('S1c.returnToA', { cardLinks, aViewUrl: page.url(), aView: aView.slice(0, 4), placeOrder: await page.getByRole('button', { name: /Place Order/ }).count() });
  expect(placeOrder).toBe(0); expect(continuePayment).toBe(0); expect(setups).toBe(1);
});

/** Disposable-database helper (operator tool, verified-TLS, loopback disposable instance only). */
function dbTool(...args: string[]) {
  const tool = process.env.REAL_STACK_DB_TOOL ?? '';
  if (!tool) throw new Error('REAL_STACK_DB_TOOL is required for fixture mutations');
  return JSON.parse(execFileSync(process.execPath, [tool, ...args], { cwd: '../backend', encoding: 'utf8', env: process.env }).trim().split('\n').at(-1) ?? '{}');
}

test('S4 — real declined card, Payment Failed, Try Again on the saved purchase (same attempt and intent)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const api = trackApi(page); const frank = customer('frank');
  await signIn(page, frank); await addProduct(page, 'c');
  await page.goto('/cart'); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await shippingAndDelivery(page); await enterCard(page, CARD_DECLINE); await reviewAndPlace(page);
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible({ timeout: 60000 });
  await shot(page, 's4-payment-failed-1366');
  const attempt = submittedAttempt(api);
  const failedState = dbTool('attempt', attempt);
  // Customer goes to Cart: the failure is listed under Failed payments; then Try Again from there.
  await page.getByRole('link', { name: /^Cart, / }).click();
  await expect(page.getByText('Failed payments')).toBeVisible({ timeout: 30000 });
  await shot(page, 's4-cart-failed-payments-1366');
  const setupsBefore = api.filter(c => c.method === 'POST' && c.path === '/api/checkout/payment-attempts').length;
  const submitsBefore = api.filter(c => c.path.endsWith('/submit')).length;
  await page.getByRole('link', { name: /Try Again/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible({ timeout: 30000 });
  const summary = await page.getByRole('complementary').or(page.locator('aside')).first().innerText().catch(() => '');
  await shot(page, 's4-retry-payment-step-1366');
  await enterCard(page, CARD_OK); await reviewAndPlace(page);
  await expect(page.getByRole('heading', { name: /Order Confirmed/i })).toBeVisible({ timeout: 90000 });
  await shot(page, 's4-retry-confirmed-1366');
  const paidState = dbTool('attempt', attempt);
  record('S4', { attempt: attempt.slice(0, 8), failedState, paidState, summaryHasItem: summary.includes('Acceptance Cable C'), summaryHasTotal: summary.includes('$9.99'),
    setupsDuringRetry: api.filter(c => c.method === 'POST' && c.path === '/api/checkout/payment-attempts').length - setupsBefore,
    submitsDuringRetry: api.filter(c => c.path.endsWith('/submit')).length - submitsBefore,
    retryCalls: api.filter(c => /resume|reconcile|submit/.test(c.path)).map(c => `${c.method} ${c.path.replace(/[0-9a-f-]{36}/g, ':id')} ${c.status ?? 'FAILED'}`) });
  expect(failedState.state).toBe('DECLINED'); expect(paidState.state).toBe('PAID');
  expect(paidState.providerIntentId).toBe(failedState.providerIntentId); expect(paidState.attemptsForCustomer).toBe(failedState.attemptsForCustomer);
  expect(api.filter(c => c.method === 'POST' && c.path === '/api/checkout/payment-attempts').length - setupsBefore).toBe(0);
  expect(api.filter(c => c.path.endsWith('/submit')).length - submitsBefore).toBe(0);
});

test('S5 — lost application responses: UNKNOWN stays unknown, worker finishes independently, refresh discovers the result', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = trackApi(page); const leo = customer('leo');
  await signIn(page, leo); await addProduct(page, 'a');
  await page.goto('/cart'); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await shippingAndDelivery(page); await enterCard(page, CARD_OK);
  // Go offline at the network layer the moment Stripe has accepted the confirmation (no route interception).
  const confirmed = page.waitForEvent('requestfinished', { predicate: r => /api\.stripe\.com\/v1\/payment_intents\/[^/]+\/confirm/.test(r.url()), timeout: 60000 });
  await reviewAndPlace(page);
  await confirmed; await context.setOffline(true);
  const offlineAt = Date.now();
  await page.waitForTimeout(20000);
  const attempt = submittedAttempt(api);
  const serverWhileOffline = dbTool('attempt', attempt);
  const headingsOffline = await page.getByRole('heading').allInnerTexts();
  const failedShown = await page.getByRole('heading', { name: 'Payment Failed' }).count();
  const placeOrderAgain = await page.getByRole('button', { name: /Place Order/ }).count();
  const toastsOffline = await toasts(page).count();
  await shot(page, 's5-offline-unknown-390');
  await context.setOffline(false);
  await page.reload();
  await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(4000); // status polling keeps the network busy
  const headingsAfterRefresh = await page.getByRole('heading').allInnerTexts();
  await shot(page, 's5-after-refresh-390');
  await page.goto('/cart');
  await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(4000); // status polling keeps the network busy
  const pendingCards = await page.getByText('Pending purchases').count();
  const toastsAfter = await toasts(page).count();
  await shot(page, 's5-cart-after-recovery-390');
  record('S5', { attempt: attempt.slice(0, 8), offlineForMs: Date.now() - offlineAt, serverWhileOffline, headingsOffline: headingsOffline.slice(0, 3), failedShown, placeOrderAgain, toastsOffline,
    headingsAfterRefresh: headingsAfterRefresh.slice(0, 3), pendingCardsAfter: pendingCards, toastsAfter, finalServer: dbTool('attempt', attempt),
    failedRequests: api.filter(c => c.status === undefined).map(c => `${c.method} ${c.path.replace(/[0-9a-f-]{36}/g, ':id')}`) });
  expect(failedShown).toBe(0); expect(placeOrderAgain).toBe(0); expect(toastsOffline).toBe(0);
  expect(serverWhileOffline.state).toBe('PAID');
});

test('S6 — Buy Now purchase A stays isolated from Cart Checkout B through A\'s late result', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const api = trackApi(page); const mia = customer(process.env.S6_CUSTOMER ?? 'mia');
  const reads: string[] = [];
  page.on('request', request => { if (/\/read$/.test(request.url())) reads.push(`${new Date().toISOString()} ${request.url().match(/attempts\/([0-9a-f]{8})/)?.[1]} on ${new URL(page.url()).pathname}${new URL(page.url()).search}`); });
  try {
  await signIn(page, mia);
  await addProduct(page, 'b');
  await page.goto(`/products/${slug('a')}`);
  await page.getByRole('button', { name: 'Buy Now' }).click();
  await expect(page.locator('#shipping-recipient')).toBeVisible({ timeout: 30000 });
  const buyNowSummary = await page.locator('aside').first().innerText().catch(() => '');
  await shippingAndDelivery(page); await enterCard(page, CARD_3DS); await reviewAndPlace(page);
  const challenge = await waitForChallenge(page);
  const attemptA = submittedAttempt(api);
  await shot(page, 's6-buy-now-a-3ds-768');
  // Full navigation (customer reloads/opens Cart): Stripe's challenge modal is torn down; the intent stays requires_action.
  await page.goto('/cart');
  await expect(page.getByText('Pending purchases')).toBeVisible({ timeout: 30000 });
  const cartLines = dbTool('cart', mia.key);
  const badge = await cartBadge(page);
  await shot(page, 's6-cart-b-with-buy-now-pending-768');
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page.locator('#shipping-recipient')).toBeVisible();
  const cleanShipping = await page.locator('#shipping-recipient').inputValue();
  await shippingAndDelivery(page); await enterCard(page, CARD_OK);
  const beforeLate = { url: page.url(), review: await page.getByRole('button', { name: 'Review Order' }).isVisible(), total: await page.getByText('$19.99').count() };
  const toastsBefore = await toasts(page).count();
  await completeAtProvider(attemptA, 'pm_card_visa');
  await expect(toasts(page)).toHaveCount(toastsBefore + 1, { timeout: 60000 });
  await shot(page, 's6-late-a-success-on-checkout-b-768');
  const afterLate = { url: page.url(), review: await page.getByRole('button', { name: 'Review Order' }).isVisible(), total: await page.getByText('$19.99').count(), badge: await cartBadge(page), cart: dbTool('cart', mia.key) };
  record('S6', { attemptA: attemptA.slice(0, 8), buyNowSummaryHasA: buyNowSummary.includes('Acceptance Headphones A'), buyNowSummaryHasB: buyNowSummary.includes('Acceptance Charger B'), challenge,
    cartLines, badge, cleanShipping, beforeLate, afterLate, aState: dbTool('attempt', attemptA).state });
  expect(afterLate.url).toBe(beforeLate.url); expect(afterLate.review).toBe(true); expect(afterLate.badge).toBe(badge);
  expect(afterLate.cart).toEqual(cartLines);
  await reviewAndPlace(page);
  await expect(page.getByRole('heading', { name: /Order Confirmed/i })).toBeVisible({ timeout: 90000 });
  await shot(page, 's6-b-confirmed-768');
  } finally {
    record('S6.reads', { customer: mia.key, reads, purchases: dbTool('purchases', mia.key) });
  }
});

test('S6r — leaving Buy Now A by in-app navigation while its 3DS challenge is open; A completes late during Checkout B', async ({ page }) => {
  // KNOWN DEFECT (Task 03.6 real acceptance, D-4): Stripe's 3DS modal outlives in-app navigation and covers Checkout B,
  // hiding the late-result toast and B's controls. Expected to fail until the navigation decision is implemented.
  test.fail(true, 'Known defect D-4: open Stripe next-action modal survives in-app navigation');
  await page.setViewportSize({ width: 768, height: 1024 });
  const api = trackApi(page); const who = customer(process.env.S6R_CUSTOMER ?? 'paul');
  const reads: string[] = []; const urls: string[] = [];
  page.on('request', request => { if (/\/read$/.test(request.url())) reads.push(`${new Date().toISOString()} ${request.url().match(/attempts\/([0-9a-f]{8})/)?.[1]} on ${new URL(page.url()).pathname}${new URL(page.url()).search}`); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) urls.push(`${new Date().toISOString()} ${new URL(frame.url()).pathname}${new URL(frame.url()).search}`); });
  let attemptA = '';
  try {
    await signIn(page, who); await addProduct(page, 'b');
    await page.goto(`/products/${slug('a')}`);
    await page.getByRole('button', { name: 'Buy Now' }).click();
    await shippingAndDelivery(page); await enterCard(page, CARD_3DS); await reviewAndPlace(page);
    await waitForChallenge(page);
    attemptA = submittedAttempt(api);
    await page.getByRole('link', { name: /^Cart, / }).click({ timeout: 10000 });
    await expect(page.getByText('Pending purchases')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click({ timeout: 10000 });
    await shippingAndDelivery(page); await enterCard(page, CARD_OK);
    const toastsBefore = await toasts(page).count();
    const marker = new Date().toISOString();
    await completeAtProvider(attemptA, 'pm_card_visa');
    const toastShown = await toasts(page).nth(toastsBefore).waitFor({ timeout: 45000 }).then(() => true, () => false);
    await shot(page, 's6r-after-late-a-768');
    record('S6r', { customer: who.key, attemptA: attemptA.slice(0, 8), completedAt: marker, toastShown, finalUrl: page.url(), review: await page.getByRole('button', { name: 'Review Order' }).count() });
    expect(toastShown).toBe(true);
    expect(new URL(page.url()).pathname).toBe('/checkout');
  } finally {
    record('S6r.trace', { customer: who.key, reads, urls, purchases: dbTool('purchases', who.key) });
  }
});

/** Creates a REAL outcome through the API stack (operator script). */
function outcome(who: string, kind: 'paid' | 'declined' | 'pending3ds', product = 'C') {
  const tool = process.env.REAL_STACK_OUTCOME_TOOL ?? '';
  if (!tool) throw new Error('REAL_STACK_OUTCOME_TOOL is required');
  return JSON.parse(execFileSync('bash', [tool, who, kind, product], { encoding: 'utf8' }).trim().split('\n').at(-1) ?? '{}') as { attemptId: string; state: string };
}
async function sampleToasts(pages: Page[], ms: number) {
  const max = pages.map(() => 0); const end = Date.now() + ms;
  while (Date.now() < end) { for (const [index, p] of pages.entries()) max[index] = Math.max(max[index]!, await toasts(p).count()); await pages[0]!.waitForTimeout(250); }
  return max;
}

test('N1 — real-backend payment notifications: one toast per authoritative outcome, acknowledged once, never for pending', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const whoBase = process.env.N1_CUSTOMER ?? 'judy'; const who = roundKey(whoBase);
  outcome(who, 'pending3ds', 'A'); // a genuinely unresolved purchase that must never toast
  const reads: string[] = [];
  context.on('request', request => { if (/\/read$/.test(request.url())) reads.push(`${new Date().toISOString()} ${request.url().match(/attempts\/([0-9a-f]{8})/)?.[1]}`); });
  const paid = outcome(who, 'paid', 'C'); const declined = outcome(who, 'declined', 'B');
  await signIn(page, customer(whoBase));
  await expect(toasts(page)).toHaveCount(2, { timeout: 30000 });
  const texts = await page.locator('li[role="status"], [role="status"]').allInnerTexts();
  await shot(page, 'n1-two-outcomes-home-1440');
  await expect(toasts(page)).toHaveCount(0, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const afterAutoDismiss = { paid: dbTool('attempt', paid.attemptId).notificationReadState, declined: dbTool('attempt', declined.attemptId).notificationReadState };
  // Refresh and customer pages: nothing replays.
  await page.reload();
  const afterReload = await sampleToasts([page], 6000);
  const perPage: Record<string, number> = {};
  for (const path of ['/products', '/orders', '/cart', '/']) { await page.goto(path); perPage[path] = (await sampleToasts([page], 4000))[0]!; }
  // Cross-tab: two visible tabs of the same customer; one new outcome must be presented once in total.
  const second = await context.newPage(); await second.setViewportSize({ width: 1440, height: 900 }); await second.goto('/orders');
  await page.goto('/products');
  const crossPaid = outcome(who, 'paid', 'A');
  const crossMax = await sampleToasts([page, second], 40000);
  // Close button: a declined outcome is closed explicitly.
  const closeDeclined = outcome(who, 'declined', 'C');
  const holder = await Promise.race([toasts(page).first().waitFor({ timeout: 40000 }).then(() => page), toasts(second).first().waitFor({ timeout: 40000 }).then(() => second)]);
  const closeText = await holder.locator('[role="status"]').first().innerText().catch(() => '');
  const closeRead = holder.waitForResponse(r => r.url().endsWith(`/${closeDeclined.attemptId}/read`));
  await toasts(holder).first().click();
  const closeStatus = (await closeRead).status();
  await shot(holder, 'n1-after-close-1440');
  const final = { paid: dbTool('attempt', paid.attemptId), declined: dbTool('attempt', declined.attemptId), crossPaid: dbTool('attempt', crossPaid.attemptId), closeDeclined: dbTool('attempt', closeDeclined.attemptId) };
  record('N1', { customer: who, created: { paid: paid.state, declined: declined.state, crossPaid: crossPaid.state, closeDeclined: closeDeclined.state }, initialToastTexts: texts.filter(Boolean),
    afterAutoDismiss, afterReloadMax: afterReload[0], perPage, crossTabMax: crossMax, closeText: closeText.slice(0, 120), closeStatus,
    readStates: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, `${v.state}/${v.notificationReadState}`])), reads });
  expect(afterAutoDismiss).toEqual({ paid: 'PAID', declined: 'DECLINED' });
  expect(afterReload[0]).toBe(0); expect(Object.values(perPage).every(n => n === 0)).toBe(true);
  expect(crossMax[0]! + crossMax[1]!).toBe(1);
  expect(closeStatus).toBe(204); expect(final.closeDeclined.notificationReadState).toBe('DECLINED');
  // The pending 3DS purchase created earlier was never notified.
  const pending = dbTool('purchases', who).rows.filter((row: { state: string }) => !['PAID', 'DECLINED'].includes(row.state));
  expect(pending.every((row: { notificationReadState: string | null }) => row.notificationReadState === null)).toBe(true);
});

test('R1 — responsive real-stack Cart (pending + failed purchases) and real Payment Element at every required viewport', async ({ page }) => {
  const who = customer(process.env.R1_CUSTOMER ?? 'judy');
  await signIn(page, who);
  await addProduct(page, 'b');
  const results: Record<string, object> = {};
  for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1280, 720], [1366, 768], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    // In-app navigation only: back-to-back hard reloads abort refresh-token rotation responses (see handoff, AUTH finding).
    const cartLink = page.getByRole('link', { name: /^Cart, / });
    if (await cartLink.isVisible()) await cartLink.click(); else await page.goto('/cart');
    await expect(page.getByText('Pending purchases')).toBeVisible({ timeout: 30000 });
    const overflowCart = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const badge = await cartBadge(page);
    await shot(page, `r1-cart-${width}`);
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await shippingAndDelivery(page);
    const frame = await stripeCardFrame(page);
    const cardWidth = await frame.getByLabel('Card number', { exact: true }).evaluate(node => node.getBoundingClientRect().width);
    const overflowCheckout = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, `r1-payment-${width}`);
    results[`${width}x${height}`] = { overflowCart, overflowCheckout, badge, cardWidth: Math.round(cardWidth) };
  }
  // The badge must equal the authoritative server Cart (saved purchases never inflate it).
  const serverQuantity = (dbTool('cart', who.key).rows as Array<{ quantity: number }>).reduce((sum, row) => sum + row.quantity, 0);
  const expectedBadge = `Cart, ${serverQuantity} ${serverQuantity === 1 ? 'item' : 'items'}`;
  record('R1', { customer: who.key, serverQuantity, results });
  for (const value of Object.values(results) as Array<{ overflowCart: number; overflowCheckout: number; badge: string | null }>) {
    expect(value.overflowCart).toBeLessThanOrEqual(0); expect(value.overflowCheckout).toBeLessThanOrEqual(0); expect(value.badge).toBe(expectedBadge);
  }
});

test('S4b — outdated delivery snapshot refuses retry safely in the browser', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const api = trackApi(page); const grace = customer('kate');
  await signIn(page, grace); await addProduct(page, 'b');
  await page.goto('/cart'); await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await shippingAndDelivery(page); await enterCard(page, CARD_DECLINE); await reviewAndPlace(page);
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible({ timeout: 60000 });
  const attempt = submittedAttempt(api);
  const before = dbTool('outdate-delivery', attempt);
  await page.getByRole('link', { name: /^Cart, / }).click();
  await expect(page.getByText('Failed payments')).toBeVisible({ timeout: 30000 });
  const resumeResponse = page.waitForResponse(r => r.url().includes(`/payment-attempts/${attempt}/resume`));
  await page.getByRole('link', { name: /Try Again/ }).first().click();
  const resumed = await resumeResponse;
  const resumeBody = await resumed.json().catch(() => null);
  const refusal = page.getByText(/can.t be paid again|changed|Nothing was charged/i).first();
  await expect(refusal).toBeVisible({ timeout: 30000 });
  await shot(page, 's4b-retry-refused-1366');
  const after = dbTool('attempt', attempt);
  const resume = { status: resumed.status(), code: resumeBody?.error?.code };
  record('S4b', { attempt: attempt.slice(0, 8), before, after, resume, refusalText: await refusal.innerText(), stripeEntryShown: await page.getByRole('button', { name: 'Review Order' }).count() });
  expect(resume).toEqual({ status: 409, code: 'CHECKOUT_CHANGED' });
  expect(after.expiresAt).toBe(before.expiresAt); expect(after.state).toBe('DECLINED'); expect(after.providerReceived).toBe(0);
});
