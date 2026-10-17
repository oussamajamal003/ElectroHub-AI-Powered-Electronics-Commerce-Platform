import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import app from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../utils/hash.js';
import { stripeProvider } from '../stripe.provider.js';
import { paymentService } from '../payment.service.js';
import { AppError } from '../../middleware/errorHandler.js';
import { InventoryService } from '../inventory.service.js';
import { assertDisposableLive } from './helpers/payment-postgres-harness.js';

// Two mutually exclusive scopes. DEV (PAYMENT_STRIPE_LIVE_DEV) is the original shared-DEV mode and keeps its guard unchanged.
// Disposable (PAYMENT_STRIPE_LIVE_DISPOSABLE) targets only a proved throwaway PostgreSQL started by scripts/payment-stripe-disposable.cjs.
const devMode = process.env.PAYMENT_STRIPE_LIVE_DEV === 'true';
const disposableLive = process.env.PAYMENT_STRIPE_LIVE_DISPOSABLE === 'true';
if (devMode && disposableLive) throw new Error('Payment live tests: the DEV and disposable scopes are mutually exclusive.');
const enabled = devMode || disposableLive;
if (devMode && (![env.DATABASE_URL, env.DIRECT_URL].every(value => value.includes('pzxekjybdiulzmssalfo')) ||
  !env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))) throw new Error('Payment live tests require exact DEV and Stripe Test Mode.');
if (disposableLive && (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ||
  [env.DATABASE_URL, env.DIRECT_URL].some(value => /pzxekjybdiulzmssalfo|yepfgjehdstlxbpespun|supabase|pooler/i.test(value)))) {
  throw new Error('Disposable payment live tests refuse DEV, PROD and hosted database URLs and require Stripe Test Mode.');
}
// Explicit owner authorization of the exact Stripe Test Mode operations: account, spend ceiling and operation set.
const liveAccount = process.env.PAYMENT_STRIPE_LIVE_EXPECTED_ACCOUNT ?? '';
const liveAllowance = Number(process.env.PAYMENT_STRIPE_LIVE_ALLOWANCE_CENTS ?? '');
const disposableDatabase = (() => { try { return new URL(process.env.PAYMENT_PG_DISPOSABLE_URL ?? '').pathname.replace(/^\//, ''); } catch { return ''; } })();
const liveAuthorization = disposableLive
  ? `STRIPE-TEST:${liveAccount}:${liveAllowance}:DISPOSABLE:${disposableDatabase}:create+authorize+capture+cancel+refund:disposable-fixtures`
  : `STRIPE-TEST:${liveAccount}:${liveAllowance}:create+authorize+capture+cancel+refund:disposable-fixtures`;
if (enabled && (!/^acct_[A-Za-z0-9]+$/.test(liveAccount) || !Number.isInteger(liveAllowance) || liveAllowance <= 0 ||
  process.env.PAYMENT_STRIPE_LIVE_AUTHORIZATION !== liveAuthorization)) {
  throw new Error('Payment live tests require the exact owner Stripe Test Mode authorization (account, allowance and operations).');
}
let authorizedCents = 0;
const prefix = `payment-gate-${randomUUID()}`;
const users: string[] = []; const products: string[] = []; const categoryIds: string[] = [];
const intents: string[] = []; const customers: { id: string; token: string }[] = [];
let categoryId: string;
const shipping = { recipient: 'Payment Test', line1: '123 Disposable Street', city: 'Test City', postalCode: '12345', country: 'United States', phone: '+1 555 010 2000' };
const auth = (token: string, route: string) => request(app).post(route).auth(token, { type: 'bearer' });
const readCart = (customer: { token: string }) => request(app).get('/api/cart').auth(customer.token, { type: 'bearer' });
async function product(stock: number, price = '1.00') {
  const id = randomUUID(); products.push(id);
  await prisma.product.create({ data: { id, categoryId, sku: `${prefix}-${id}`, slug: `${prefix}-${id}`, name: 'Disposable Payment Product', price,
    // Acceptance-fixture contract (STOREFRONT_FIXTURE_VISIBILITY.md): purchasable through Cart/Checkout, hidden from the storefront.
    isTestFixture: false, storefrontVisible: false,
    inventory: { create: { quantity: stock, lowStockAt: 5, status: stock <= 5 ? 'LOW_STOCK' : 'IN_STOCK' } },
    images: { create: { url: '/images/catalog/variety/apple-phone-generic-01.jpg', isPrimary: true } } } });
  return id;
}
async function prepare(customer: { id: string; token: string }, lines: { productId: string; quantity: number }[]) {
  const active = await prisma.paymentAttempt.findFirst({ where: { userId: customer.id, activeCartId: { not: null } } });
  if (active) {
    if (active.orderId) expect((await settle(customer, active.id)).body.data.state).toBe('PAID');
    else {
      const canceled = await auth(customer.token, `/api/checkout/payment-attempts/${active.id}/cancel`).send({});
      expect(canceled.body.data?.state).toBe('CANCELED');
    }
  }
  const cart = await prisma.cart.upsert({ where: { userId: customer.id }, create: { userId: customer.id }, update: {} });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  for (const line of lines) expect((await auth(customer.token, '/api/cart/items').send(line)).status).toBe(201);
  const quote = await request(app).get('/api/checkout').auth(customer.token, { type: 'bearer' }); expect(quote.status).toBe(200);
  return { shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: quote.body.data.cartRevision };
}
async function setup(customer: { token: string }, body: object, key = randomUUID(), resolveProvider = true) {
  const response = await auth(customer.token, '/api/checkout/payment-attempts').set('Idempotency-Key', key).send(body);
  expect([200, 201, 202]).toContain(response.status);
  let saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: response.body.data.attemptId } });
  // 202 is a supported unknown-create outcome. Resume that exact attempt, never replace its key.
  for (let read = 0; resolveProvider && !saved.providerIntentId && saved.state === 'PREPARING' && read < 3; read++) {
    await auth(customer.token, `/api/checkout/payment-attempts/${saved.id}/reconcile`).send({});
    saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.id } });
  }
  if (saved.providerIntentId && !intents.includes(saved.providerIntentId)) intents.push(saved.providerIntentId);
  return { key, id: saved.id, intentId: saved.providerIntentId, response };
}
const submitPurchase = (customer: { token: string }, id: string) => auth(customer.token, `/api/checkout/payment-attempts/${id}/submit`).send({});
async function authorize(intentId: string | null, method = 'pm_card_visa', options: { tolerateSubmitRejection?: boolean } = {}) {
  if (!intentId) throw new Error('PaymentIntent not yet bound');
  // Current lifecycle: the customer's final action first submits (transfers) the Cart generation, then confirms the card.
  // An attempt that is not bound yet, or was already submitted (retry flow), skips the submit exactly as the UI does.
  const bound = await prisma.paymentAttempt.findUnique({ where: { providerIntentId: intentId } });
  if (bound) {
    authorizedCents += bound.amountCents;
    if (authorizedCents > liveAllowance) throw new Error('The owner-stated Stripe Test Mode allowance would be exceeded; stopping before the provider call.');
    const customer = customers.find(candidate => candidate.id === bound.userId);
    if (!bound.submittedAt && customer) {
      const submitted = await submitPurchase(customer, bound.id);
      if (!options.tolerateSubmitRejection) { expect(submitted.status).toBeGreaterThanOrEqual(200); expect(submitted.status).toBeLessThan(300); }
    }
  }
  try { return await stripeProvider.sdk().paymentIntents.confirm(intentId, { payment_method: method, return_url: 'http://localhost:3000/checkout?step=review' }); }
  catch (error) {
    // Never print a provider exception containing client_secret, payment fields or a raw response.
    const category = error && typeof error === 'object' && 'type' in error ? String(error.type) : 'unknown';
    throw new Error(`Test authorization failed (${category}); inspect sanitized provider status.`);
  }
}
/**
 * Current contract: POST /reconcile wakes the durable identity and returns promptly; the worker pass it starts finishes in the
 * background. Observe the outcome by awaiting exactly the pass(es) this request started, then reading the owned status (same
 * projection as the reconcile body). No sleep, no new key, no client-side state.
 */
// One shared wrapper around the REAL method (never a spy of a spy), so concurrent reconcile() calls each collect their passes.
const realProcess = Object.getPrototypeOf(paymentService).process as typeof paymentService.process;
const passCollectors = new Set<Promise<unknown>[]>();
let processSpy: { mockRestore(): void } | undefined;
async function reconcile(customer: { token: string }, id: string) {
  const passes: Promise<unknown>[] = []; passCollectors.add(passes);
  processSpy ??= vi.spyOn(paymentService, 'process').mockImplementation((...args) => {
    const pass = realProcess.apply(paymentService, args);
    for (const collector of passCollectors) collector.push(pass.catch(() => undefined));
    return pass;
  });
  let woke;
  try { woke = await auth(customer.token, `/api/checkout/payment-attempts/${id}/reconcile`).send({}); }
  finally { passCollectors.delete(passes); if (!passCollectors.size) { processSpy?.mockRestore(); processSpy = undefined; } }
  await Promise.all(passes);
  if (woke.status >= 300) return woke;
  const read = await request(app).get(`/api/checkout/payment-attempts/${id}`).auth(customer.token, { type: 'bearer' });
  if (read.status !== 200) return read;
  // Same status semantics as the reconcile route: 200 for a terminal outcome, 202 while work remains.
  const terminalState = ['PAID', 'DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED', 'INCIDENT'].includes(read.body.data.state);
  return { status: terminalState ? 200 : 202, body: read.body };
}
async function settle(customer: { token: string }, id: string) {
  // Each read resumes the exact durable identity. No sleep, new key or blind timeout success.
  let result = await reconcile(customer, id);
  for (let check = 0; check < 4 && !['PAID', 'CANCELED', 'COMPENSATED', 'REFUNDED', 'INCIDENT'].includes(result.body.data?.state); check++) result = await reconcile(customer, id);
  if (!['PAID', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(result.body.data?.state)) {
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id }, include: { work: true } });
    console.log(JSON.stringify({ gate: 'unresolved real payment', attemptId: id, state: saved.state, code: saved.failureCode, workError: saved.work?.lastError }));
  }
  return result;
}
const stock = async (id: string) => (await prisma.inventory.findUniqueOrThrow({ where: { productId: id } })).quantity;
async function restartedRunner(id: string) {
  await paymentService.wake(id);
  const child = spawn(process.execPath, ['dist/payment-runner.js', '--once', `--attempt=${id}`],
    { env: { ...process.env, NODE_ENV: 'test' }, windowsHide: true, stdio: 'ignore' });
  const code = await new Promise<number | null>((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  expect(code).toBe(0);
}
async function state(userId: string, ids: string[]) {
  return { orders: await prisma.order.count({ where: { userId } }), payments: await prisma.payment.count({ where: { order: { userId } } }),
    items: await prisma.orderItem.count({ where: { order: { userId } } }),
    cart: await prisma.cartItem.findMany({ where: { cart: { userId } }, select: { productId: true, quantity: true }, orderBy: { productId: 'asc' } }),
    inventory: await prisma.inventory.findMany({ where: { productId: { in: ids } }, select: { productId: true, quantity: true }, orderBy: { productId: 'asc' } }) };
}
function failAcknowledgement(boundary: 'binding' | 'capture' | 'cancel') {
  const transaction = prisma.$transaction.bind(prisma); const fault = { calls: 0 };
  // Financial writes use the transaction client, not the outer Prisma delegate.
  // Keep the real transaction/queries; fail exactly one write at the proven boundary.
  vi.spyOn(prisma, '$transaction').mockImplementation((operation, options) => transaction(async tx => {
    if (boundary === 'capture') {
      const update = tx.payment.update.bind(tx.payment);
      vi.spyOn(tx.payment, 'update').mockImplementation(args => {
        if (!fault.calls && args.data.status === 'SUCCEEDED') { fault.calls++; throw new Error('Controlled captured payment write failure'); }
        return update(args);
      });
    } else {
      const update = tx.paymentAttempt.update.bind(tx.paymentAttempt);
      vi.spyOn(tx.paymentAttempt, 'update').mockImplementation(args => {
        if (!fault.calls && (boundary === 'binding' ? Boolean(args.data.providerIntentId) : args.data.state === 'CANCELED')) {
          fault.calls++; throw new Error('Controlled provider acknowledgement write failure');
        }
        return update(args);
      });
    }
    return operation(tx);
  }, options));
  return fault;
}

describe.skipIf(!enabled)('REAL DEV API/PostgreSQL + Stripe Test Mode; disposable fixtures only', () => {
  beforeAll(async () => {
    if (disposableLive) await assertDisposableLive(); // target proof before any database or provider activity
    expect((await prisma.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='payment_attempts') AS present`))[0]?.present).toBe(true);
    expect(await stripeProvider.account()).toBe(liveAccount); // account identity preflight before any mutation
    if (!disposableLive) {
      const lines = readFileSync('.env', 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const email = lines.at(-2); const password = lines.at(-1);
      if (!email || !password || !/^[^=\s]+@[^=\s]+\.[^=\s]+$/.test(email)) throw new Error('Approved DEV login unavailable');
      const approved = await request(app).post('/api/auth/login').send({ email, password }); expect(approved.status).toBe(200);
      expect((await request(app).get('/api/auth/me').auth(approved.body.accessToken, { type: 'bearer' })).status).toBe(200);
    }
    const role = disposableLive ? await prisma.role.upsert({ where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' }, update: {} })
      : await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const category = await prisma.category.create({ data: { name: prefix, slug: prefix, isActive: true } }); categoryId = category.id; categoryIds.push(categoryId);
    for (let index = 0; index < 2; index++) {
      const id = randomUUID(); const email = `${prefix}-${index}@example.invalid`; const password = `Payment-${randomUUID()}-A1!`;
      users.push(id); await prisma.user.create({ data: { id, email, passwordHash: await hashPassword(password), roleId: role.id,
        firstName: 'Payment', lastName: 'Disposable', emailVerifiedAt: new Date() } });
      const login = await request(app).post('/api/auth/login').send({ email, password }); expect(login.status).toBe(200);
      expect(login.body.user.id).toBe(id); expect(login.body.user.role).toBe('CUSTOMER'); customers.push({ id, token: login.body.accessToken });
    }
  }, 180000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    vi.restoreAllMocks();
    // Provider cleanup touches only intents explicitly created by these disposable test attempts.
    for (const id of intents) {
      const intent = await stripeProvider.retrieve(id);
      if (intent.status === 'succeeded') {
        const refunds = await stripeProvider.sdk().refunds.list({ payment_intent: id, limit: 10 });
        const refunded = refunds.data.filter(value => value.status !== null && ['succeeded', 'pending', 'requires_action'].includes(value.status)).reduce((sum, value) => sum + value.amount, 0);
        if (refunded < intent.received) await stripeProvider.sdk().refunds.create({ payment_intent: id, amount: intent.received - refunded }, { idempotencyKey: `${prefix}:${id}:cleanup` });
      } else if (intent.status !== 'canceled') await stripeProvider.sdk().paymentIntents.cancel(id, {}, { idempotencyKey: `${prefix}:${id}:cleanup` });
    }
    await prisma.$transaction(async tx => {
      if (users.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "payment_attempts"
        WHERE "userId" IN (${Prisma.join(users.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`);
      await tx.stripeEvent.deleteMany({ where: { attempt: { userId: { in: users } } } });
      await tx.paymentWork.deleteMany({ where: { attempt: { userId: { in: users } } } });
      await tx.paymentAttemptItem.deleteMany({ where: { attempt: { userId: { in: users } } } });
      await tx.paymentAttempt.deleteMany({ where: { userId: { in: users } } });
      await tx.payment.deleteMany({ where: { order: { userId: { in: users } } } });
      await tx.order.deleteMany({ where: { userId: { in: users } } });
      await tx.cartItem.deleteMany({ where: { cart: { userId: { in: users } } } });
      await tx.product.deleteMany({ where: { id: { in: products } } });
      await tx.user.deleteMany({ where: { id: { in: users } } }); await tx.category.deleteMany({ where: { id: { in: categoryIds } } });
    }, { timeout: 30_000, maxWait: 10_000 });
    expect(await prisma.product.count({ where: { id: { in: products } } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: users } } })).toBe(0);
    console.log('REAL Stripe/DEV fixture cleanup PASS; curated data and PROD untouched.'); await prisma.$disconnect();
  }, 180000);
  it('setup has no purchase effects; full authorization commits multi-item snapshots and captures once', async () => {
    const customer = customers[0]; const other = customers[1]; if (!customer || !other) throw new Error('Missing customer fixtures');
    const ids = [await product(3), await product(5, '0.50')];
    const body = await prepare(customer, [{ productId: ids[0] ?? '', quantity: 2 }, { productId: ids[1] ?? '', quantity: 3 }]);
    const before = await state(customer.id, ids); const attempt = await setup(customer, body);
    expect(await state(customer.id, ids)).toEqual(before); expect(attempt.response.body.data.total).toBe('3.50');
    const authorized = await authorize(attempt.intentId); expect(authorized.status).toBe('requires_capture'); expect(authorized.amount_capturable).toBe(350);
    // authorize() performs the customer's /submit first: the Cart generation is transferred, nothing is purchased yet.
    const { cart: transferredCart, ...purchaseEffects } = await state(customer.id, ids);
    const { cart: _beforeCart, ...beforeEffects } = before; void _beforeCart;
    expect(purchaseEffects).toEqual(beforeEffects); expect(transferredCart).toEqual([]);
    const result = await settle(customer, attempt.id); expect(result.status).toBe(200); expect(result.body.data.state).toBe('PAID');
    expect(result.body.data.confirmation).toMatchObject({ paymentState: 'PAID', total: '3.50', card: { brand: 'visa', last4: '4242' } });
    expect(await stock(ids[0] ?? '')).toBe(1); expect(await stock(ids[1] ?? '')).toBe(2); expect((await readCart(customer)).body.data.items).toEqual([]);
    const after = await state(customer.id, ids); expect(after.orders).toBe(before.orders + 1); expect(after.payments).toBe(before.payments + 1);
    expect((await reconcile(customer, attempt.id)).body.data.confirmation).toEqual(result.body.data.confirmation); expect(await state(customer.id, ids)).toEqual(after);
    const provider = await stripeProvider.retrieve(attempt.intentId ?? ''); expect(provider.status).toBe('succeeded'); expect(provider.received).toBe(350);
    expect((await request(app).get(`/api/checkout/payment-attempts/${attempt.id}`).auth(other.token, { type: 'bearer' })).status).toBe(404);
    expect((await auth(customer.token, '/api/checkout/payment-attempts').set('Idempotency-Key', attempt.key).send({ ...body, deliveryMethod: 'EXPRESS' })).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    console.log(JSON.stringify({ gate: 'real Stripe authorize/commit/capture/replay/ownership', before, after, attempt: attempt.id, intent: attempt.intentId, amount: provider.received }));
  }, 240000);
  it('duplicate and concurrent submit transfers the Cart once and the purchase still captures exactly once', async () => {
    const customer = customers[0]!; const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }]));
    const [first, second] = await Promise.all([submitPurchase(customer, attempt.id), submitPurchase(customer, attempt.id)]);
    for (const response of [first, second]) { expect(response.status).toBeGreaterThanOrEqual(200); expect(response.status).toBeLessThan(300); }
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).submittedAt).not.toBeNull();
    await authorize(attempt.intentId);
    expect((await settle(customer, attempt.id)).body.data.state).toBe('PAID');
    expect(await stock(id)).toBe(4);
    expect(await prisma.order.count({ where: { userId: customer.id, items: { some: { productId: id } } } })).toBe(1);
    const intent = await stripeProvider.retrieve(attempt.intentId!); expect(intent.received).toBe(intent.amount);
  });

  it('unknown capture after real Stripe success reconciles without second capture or stock release', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 2 }])); await authorize(attempt.intentId);
    const capture = stripeProvider.capture.bind(stripeProvider);
    const spy = vi.spyOn(stripeProvider, 'capture').mockImplementationOnce(async value => { await capture(value); throw new AppError('Controlled transport uncertainty.', 503, 'PAYMENT_PROVIDER_UNKNOWN'); });
    expect((await reconcile(customer, attempt.id)).body.data.state).toBe('CAPTURE_PENDING'); expect(await stock(id)).toBe(3);
    const restored = await reconcile(customer, attempt.id); expect(restored.body.data.state).toBe('PAID'); expect(spy).toHaveBeenCalledTimes(1);
    expect(await stock(id)).toBe(3); expect((await readCart(customer)).body.data.items).toEqual([]);
  }, 180000);
  it('real terminal cancellation after committed capture rejection compensates once and keeps the newer Cart intent separate', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(10);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 2 }])); await authorize(attempt.intentId);
    vi.spyOn(stripeProvider, 'capture').mockImplementationOnce(async saved => {
      expect((await auth(customer.token, '/api/cart/items').send({ productId: id, quantity: 1 })).status).toBe(201);
      await stripeProvider.cancel(saved); throw new AppError('Controlled capture rejection.', 409, 'PAYMENT_CAPTURE_REJECTED');
    });
    const result = await reconcile(customer, attempt.id); expect(result.body.data.state).toBe('COMPENSATED'); expect(await stock(id)).toBe(10);
    // Current contract: a SUBMITTED purchase never merges back into the active Cart; the newer line stays as-is and the
    // purchased quantity is recorded as the recovery remainder.
    expect((await readCart(customer)).body.data.items).toMatchObject([{ productId: id, quantity: 1 }]);
    expect(result.body.data.recoveryRemainder).toEqual([{ productId: id, quantity: 2 }]);
    expect(result.body.data.confirmation).toMatchObject({ status: 'CANCELLED', paymentState: 'FAILED' });
    await reconcile(customer, attempt.id); expect(await stock(id)).toBe(10); expect((await readCart(customer)).body.data.items).toMatchObject([{ quantity: 1 }]);
  }, 180000);
  it('two authorized customers cannot both purchase the last unit', async () => {
    const a = customers[0]; const b = customers[1]; if (!a || !b) throw new Error('Missing customers'); const id = await product(1);
    const first = await setup(a, await prepare(a, [{ productId: id, quantity: 1 }])); const second = await setup(b, await prepare(b, [{ productId: id, quantity: 1 }]));
    await Promise.all([authorize(first.intentId, 'pm_card_visa', { tolerateSubmitRejection: true }), authorize(second.intentId, 'pm_card_visa', { tolerateSubmitRejection: true })]);
    const result = await Promise.all([reconcile(a, first.id), reconcile(b, second.id)]);
    expect(result.map(value => value.body.data.state).sort()).toEqual(['CANCELED', 'PAID']); expect(await stock(id)).toBe(0);
    expect(await prisma.order.count({ where: { items: { some: { productId: id } } } })).toBe(1);
    expect((await Promise.all([stripeProvider.retrieve(first.intentId ?? ''), stripeProvider.retrieve(second.intentId ?? '')])).map(value => value.status).sort()).toEqual(['canceled', 'succeeded']);
  }, 240000);
  it.each(['same', 'different'])('same Cart overlapping %s keys cannot create competing purchases', async mode => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const body = await prepare(customer, [{ productId: id, quantity: 2 }]); const key = randomUUID();
    const results = await Promise.all([auth(customer.token, '/api/checkout/payment-attempts').set('Idempotency-Key', key).send(body),
      auth(customer.token, '/api/checkout/payment-attempts').set('Idempotency-Key', mode === 'same' ? key : randomUUID()).send(body)]);
    // Current contract: a different key with identical checkout details is a compatible replay of the active attempt
    // (unit: "still reuses compatible awaiting-input setup without making duplicate attempts"). Both succeed; one attempt.
    const good = results.filter(value => [200, 201, 202].includes(value.status)); expect(good.length).toBe(2);
    expect(new Set(good.map(value => value.body.data.attemptId)).size).toBe(1);
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: good[0]?.body.data.attemptId } });
    if (saved.providerIntentId) intents.push(saved.providerIntentId);
    await authorize(saved.providerIntentId); expect((await reconcile(customer, saved.id)).body.data.state).toBe('PAID'); expect(await stock(id)).toBe(3);
    expect(await prisma.order.count({ where: { items: { some: { productId: id } } } })).toBe(1);
  }, 240000);
  it('provider create succeeds but its reply is lost before binding; fresh runner reuses exact provider identity', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    let createdId = '';
    const create = stripeProvider.create.bind(stripeProvider);
    vi.spyOn(stripeProvider, 'create').mockImplementationOnce(async saved => { const intent = await create(saved); createdId = intent.id;
      if (!intents.includes(intent.id)) intents.push(intent.id); throw new Error('Controlled lost provider-create reply before binding.'); });
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }]), randomUUID(), false);
    expect(attempt.intentId).toBeNull(); expect(createdId).not.toBe(''); expect(await stock(id)).toBe(5);
    vi.restoreAllMocks(); await restartedRunner(attempt.id);
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).providerIntentId).toBe(createdId);
    await authorize(createdId); expect((await settle(customer, attempt.id)).body.data.state).toBe('PAID'); expect(await stock(id)).toBe(4);
  }, 240000);
  it('real decline and action-required authorization have zero purchase effects', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    for (const [method, expected] of [['pm_card_chargeDeclined', 'DECLINED'], ['pm_card_threeDSecure2Required', 'ACTION_REQUIRED']] as const) {
      const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }])); const before = await state(customer.id, [id]);
      if (!attempt.intentId) throw new Error('Missing provider binding');
      try { await stripeProvider.sdk().paymentIntents.confirm(attempt.intentId, { payment_method: method, return_url: 'http://localhost:3000/checkout?step=review' }); }
      catch (error) { expect(error && typeof error === 'object' && 'type' in error ? error.type : null).toBe('StripeCardError'); }
      expect((await reconcile(customer, attempt.id)).body.data.state).toBe(expected); expect(await state(customer.id, [id])).toEqual(before);
      expect((await auth(customer.token, `/api/checkout/payment-attempts/${attempt.id}/cancel`).send({})).body.data.state).toBe('CANCELED');
    }
  }, 240000);
  it('unknown real refund resumes its stable identity after fresh process restart', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }])); await authorize(attempt.intentId);
    if (!attempt.intentId) throw new Error('Missing provider binding');
    // Controlled unexpected capture outside purchase commit: the repair must refund, never manufacture an Order.
    await stripeProvider.sdk().paymentIntents.capture(attempt.intentId); const before = await state(customer.id, [id]);
    const refund = stripeProvider.refund.bind(stripeProvider); let refundId = '';
    vi.spyOn(stripeProvider, 'refund').mockImplementationOnce(async (saved, amount) => { const result = await refund(saved, amount); refundId = result.id; throw new Error('Controlled lost refund response.'); });
    expect((await reconcile(customer, attempt.id)).body.data.state).toBe('REFUND_PENDING'); expect(await state(customer.id, [id])).toEqual(before);
    vi.restoreAllMocks(); await restartedRunner(attempt.id);
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }); expect(saved.state).toBe('REFUNDED'); expect(saved.refundId).toBe(refundId);
    const refunds = await stripeProvider.sdk().refunds.list({ payment_intent: attempt.intentId, limit: 10 }); expect(refunds.data).toHaveLength(1); expect(refunds.data[0]?.amount).toBe(100);
    expect(await state(customer.id, [id])).toEqual(before);
  }, 240000);
  it('partial compensation rolls back; restarted and overlapping workers restore exactly once', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const ids = [await product(10), await product(10)];
    const attempt = await setup(customer, await prepare(customer, [{ productId: ids[0] ?? '', quantity: 2 }, { productId: ids[1] ?? '', quantity: 3 }])); await authorize(attempt.intentId);
    vi.spyOn(stripeProvider, 'capture').mockImplementationOnce(async saved => { await stripeProvider.cancel(saved); throw new AppError('Controlled capture rejection.', 409, 'PAYMENT_CAPTURE_REJECTED'); });
    const increase = InventoryService.prototype.increaseStock; let calls = 0;
    vi.spyOn(InventoryService.prototype, 'increaseStock').mockImplementation(async function (this: InventoryService, ...args) { const result = await increase.apply(this, args); if (++calls === 2) throw new Error('Controlled second restore interruption.'); return result; });
    expect((await reconcile(customer, attempt.id)).body.data.state).toBe('COMPENSATION_PENDING'); expect(await stock(ids[0] ?? '')).toBe(8); expect(await stock(ids[1] ?? '')).toBe(7);
    expect((await readCart(customer)).body.data.items).toEqual([]);
    vi.restoreAllMocks(); await Promise.all([restartedRunner(attempt.id), reconcile(customer, attempt.id)]);
    expect((await settle(customer, attempt.id)).body.data.state).toBe('COMPENSATED'); expect(await stock(ids[0] ?? '')).toBe(10); expect(await stock(ids[1] ?? '')).toBe(10);
    // Submitted purchase: nothing merges into the Cart; both lines are recorded once as the recovery remainder.
    expect((await readCart(customer)).body.data.items).toEqual([]);
    expect((await reconcile(customer, attempt.id)).body.data.recoveryRemainder.map((line: { quantity: number }) => line.quantity).sort()).toEqual([2, 3]);
    await restartedRunner(attempt.id); expect(await stock(ids[0] ?? '')).toBe(10); expect(await stock(ids[1] ?? '')).toBe(10);
  }, 300000);
  it('expired worker after real capture cannot downgrade state; fresh runner reads success without recapture', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }])); await authorize(attempt.intentId);
    const capture = stripeProvider.capture.bind(stripeProvider); const spy = vi.spyOn(stripeProvider, 'capture').mockImplementationOnce(async saved => {
      const intent = await capture(saved); await prisma.paymentWork.update({ where: { attemptId: saved.id }, data: { leaseUntil: new Date(0) } }); return intent;
    });
    expect((await reconcile(customer, attempt.id)).body.data.state).toBe('CAPTURE_PENDING'); expect(spy).toHaveBeenCalledTimes(1); expect(await stock(id)).toBe(4);
    vi.restoreAllMocks(); await restartedRunner(attempt.id); expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('PAID'); expect(await stock(id)).toBe(4);
    if (!attempt.intentId) throw new Error('Missing intent'); expect((await stripeProvider.retrieve(attempt.intentId)).received).toBe(100);
  }, 240000);
  it('Cart mutation during authorization rejects stale purchase and preserves the newer Cart', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 2 }]));
    expect((await request(app).patch(`/api/cart/items/${id}`).auth(customer.token, { type: 'bearer' }).send({ quantity: 1 })).status).toBe(200);
    // Current lifecycle: the final action submits the saved Cart generation BEFORE card confirmation, so a changed Cart is
    // refused there (fail closed) and no authorization is ever requested for the stale purchase.
    const before = await state(customer.id, [id]);
    const submitted = await submitPurchase(customer, attempt.id); expect(submitted.status).toBe(409); expect(submitted.body.error.code).toBe('CHECKOUT_CHANGED');
    expect(await state(customer.id, [id])).toEqual(before); expect(before.cart).toEqual([{ productId: id, quantity: 1 }]);
    if (!attempt.intentId) throw new Error('Missing intent'); expect((await stripeProvider.retrieve(attempt.intentId)).status).toBe('requires_payment_method');
    expect((await auth(customer.token, `/api/checkout/payment-attempts/${attempt.id}/cancel`).send({})).body.data.state).toBe('CANCELED');
    expect(await state(customer.id, [id])).toEqual(before);
  }, 240000);
  it('authorized browser abandonment is completed by a fresh runner without browser consent replay', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }]));
    await authorize(attempt.intentId); await restartedRunner(attempt.id);
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(saved.state).toBe('PAID'); expect(saved.orderId).not.toBeNull(); expect(await stock(id)).toBe(4);
    expect((await readCart(customer)).body.data.items).toEqual([]);
    await restartedRunner(attempt.id); expect(await stock(id)).toBe(4);
  }, 240000);
  it('lost terminal cancellation reply is recovered by fresh provider truth with no purchase effects', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }])); const before = await state(customer.id, [id]);
    const cancel = stripeProvider.cancel.bind(stripeProvider);
    vi.spyOn(stripeProvider, 'cancel').mockImplementationOnce(async saved => { await cancel(saved); throw new Error('Controlled lost cancellation reply.'); });
    const response = await auth(customer.token, `/api/checkout/payment-attempts/${attempt.id}/cancel`).send({});
    expect(response.status).toBe(202); expect(response.body.data.state).toBe('CANCEL_PENDING'); expect(await state(customer.id, [id])).toEqual(before);
    vi.restoreAllMocks(); await restartedRunner(attempt.id);
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('CANCELED');
    expect(await state(customer.id, [id])).toEqual(before);
  }, 240000);
  it('real second-item purchase failure rolls back earlier writes before safe same-attempt recovery', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const ids = [await product(5), await product(5)];
    const attempt = await setup(customer, await prepare(customer, ids.map(productId => ({ productId, quantity: 1 }))));
    await authorize(attempt.intentId); const before = await state(customer.id, ids);
    const decrease = InventoryService.prototype.decreaseStock; let writes = 0;
    vi.spyOn(InventoryService.prototype, 'decreaseStock').mockImplementation(async function (this: InventoryService, ...args) {
      const value = await decrease.apply(this, args); if (++writes === 2) throw new Error('Controlled second purchase write failure.'); return value;
    });
    expect((await reconcile(customer, attempt.id)).status).toBe(202); expect(writes).toBe(2);
    expect(await state(customer.id, ids)).toEqual(before);
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).orderId).toBeNull();
    vi.restoreAllMocks(); await restartedRunner(attempt.id);
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('PAID');
    for (const id of ids) expect(await stock(id)).toBe(4);
    expect((await readCart(customer)).body.data.items).toEqual([]);
  }, 300000);
  it('expired uncommitted intent cancels through a fresh worker without changing Cart or Inventory', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }])); const before = await state(customer.id, [id]);
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { expiresAt: new Date(0) } });
    await restartedRunner(attempt.id);
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('CANCELED');
    expect(await state(customer.id, [id])).toEqual(before);
  }, 240000);
  it('DEV financial CHECKs and unique work/provider/event bindings are physically enforced', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }]));
    await expect(prisma.$transaction(tx => tx.paymentAttempt.update({ where: { id: attempt.id }, data: { amountCents: -1 } }))).rejects.toThrow();
    await expect(prisma.$transaction(tx => tx.paymentAttemptItem.updateMany({ where: { attemptId: attempt.id }, data: { quantity: 0 } }))).rejects.toThrow();
    await expect(prisma.paymentWork.create({ data: { attemptId: attempt.id } })).rejects.toMatchObject({ code: 'P2002' });
    const eventId = `evt_disposable_${randomUUID()}`; const event = { id: eventId, type: 'payment_intent.succeeded', attemptId: attempt.id, providerIntentId: attempt.intentId, disposition: 'ACCEPTED' };
    await prisma.stripeEvent.create({ data: event }); await expect(prisma.stripeEvent.create({ data: event })).rejects.toMatchObject({ code: 'P2002' });
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).amountCents).toBe(100); expect(await stock(id)).toBe(5);
    expect((await auth(customer.token, `/api/checkout/payment-attempts/${attempt.id}/cancel`).send({})).body.data.state).toBe('CANCELED');
  }, 240000);
  it.each(['price', 'product', 'category'] as const)('authoritative %s change after real authorization follows the submitted-purchase contract (price: saved price honored; product/category: cancel)', async change => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }])); await authorize(attempt.intentId);
    try {
      if (change === 'price') await prisma.product.update({ where: { id }, data: { price: '1.05' } });
      else if (change === 'product') await prisma.product.update({ where: { id }, data: { status: 'INACTIVE' } });
      else await prisma.category.update({ where: { id: categoryId }, data: { isActive: false } });
      const before = await state(customer.id, [id]); const response = await settle(customer, attempt.id);
      if (!attempt.intentId) throw new Error('Missing intent');
      if (change === 'price') {
        // Submitted purchase: OrderService validates the saved unit price the customer consented to and Stripe authorized;
        // a later catalog price change neither cancels nor re-prices it (pending Architect confirmation, see handoff).
        expect(response.body.data.state).toBe('PAID');
        const order = await prisma.order.findFirstOrThrow({ where: { userId: customer.id, items: { some: { productId: id } } }, include: { items: true } });
        expect(order.items.map(item => item.unitPrice.toFixed(2))).toEqual(['1.00']);
        expect((await stripeProvider.retrieve(attempt.intentId)).received).toBe(100); expect(await stock(id)).toBe(4);
      } else {
        expect(response.body.data.state).toBe('CANCELED'); expect(await state(customer.id, [id])).toEqual(before);
        expect((await stripeProvider.retrieve(attempt.intentId)).status).toBe('canceled');
      }
    } finally { if (change === 'category') await prisma.category.update({ where: { id: categoryId }, data: { isActive: true } }); }
  }, 240000);
  it('a provider intent cannot be bound to two owned attempts in the real database', async () => {
    const firstCustomer = customers[0]; const secondCustomer = customers[1]; if (!firstCustomer || !secondCustomer) throw new Error('Missing customers');
    const id = await product(5);
    const first = await setup(firstCustomer, await prepare(firstCustomer, [{ productId: id, quantity: 1 }]));
    const second = await setup(secondCustomer, await prepare(secondCustomer, [{ productId: id, quantity: 1 }]));
    if (!first.intentId || !second.intentId) throw new Error('Provider setup unresolved');
    await expect(prisma.paymentAttempt.update({ where: { id: second.id }, data: { providerIntentId: first.intentId } })).rejects.toMatchObject({ code: 'P2002' });
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: second.id } })).providerIntentId).toBe(second.intentId);
    expect(await stock(id)).toBe(5);
    expect((await auth(firstCustomer.token, `/api/checkout/payment-attempts/${first.id}/cancel`).send({})).body.data.state).toBe('CANCELED');
    expect((await auth(secondCustomer.token, `/api/checkout/payment-attempts/${second.id}/cancel`).send({})).body.data.state).toBe('CANCELED');
  }, 300000);
  it.each(['binding', 'capture', 'cancel'] as const)('provider %s succeeds but local acknowledgement fails; fresh worker preserves identity', async boundary => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    let createdIntent = '';
    if (boundary === 'binding') {
      const create = stripeProvider.create.bind(stripeProvider);
      vi.spyOn(stripeProvider, 'create').mockImplementationOnce(async saved => { const intent = await create(saved); createdIntent = intent.id; intents.push(intent.id); return intent; });
    }
    const bindingFault = boundary === 'binding' ? failAcknowledgement(boundary) : null;
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }]), randomUUID(), boundary !== 'binding');
    if (boundary === 'binding') {
      expect(bindingFault?.calls).toBe(1);
      expect(createdIntent).not.toBe(''); expect(attempt.intentId).toBeNull();
      vi.restoreAllMocks(); await restartedRunner(attempt.id);
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).providerIntentId).toBe(createdIntent);
      expect(await stock(id)).toBe(5);
      expect((await auth(customer.token, `/api/checkout/payment-attempts/${attempt.id}/cancel`).send({})).body.data.state).toBe('CANCELED');
    } else if (boundary === 'capture') {
      await authorize(attempt.intentId);
      const fault = failAcknowledgement(boundary);
      expect((await reconcile(customer, attempt.id)).body.data.state).toBe('CAPTURE_PENDING');
      expect(fault.calls).toBe(1);
      if (!attempt.intentId) throw new Error('Missing intent'); expect((await stripeProvider.retrieve(attempt.intentId)).status).toBe('succeeded');
      expect(await stock(id)).toBe(4); vi.restoreAllMocks(); await restartedRunner(attempt.id);
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('PAID'); expect(await stock(id)).toBe(4);
    } else {
      const fault = failAcknowledgement(boundary);
      expect((await auth(customer.token, `/api/checkout/payment-attempts/${attempt.id}/cancel`).send({})).body.data.state).toBe('CANCEL_PENDING');
      expect(fault.calls).toBe(1);
      if (!attempt.intentId) throw new Error('Missing intent'); expect((await stripeProvider.retrieve(attempt.intentId)).status).toBe('canceled');
      vi.restoreAllMocks(); await restartedRunner(attempt.id);
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('CANCELED'); expect(await stock(id)).toBe(5);
    }
  }, 300000);
  it('a real pending refund survives process restart without duplicate refund or early release', async () => {
    const customer = customers[0]; if (!customer) throw new Error('Missing customer'); const id = await product(5);
    const attempt = await setup(customer, await prepare(customer, [{ productId: id, quantity: 1 }]));
    await authorize(attempt.intentId, 'pm_card_pendingRefund');
    if (!attempt.intentId) throw new Error('Missing intent'); await stripeProvider.sdk().paymentIntents.capture(attempt.intentId);
    const before = await state(customer.id, [id]); const result = await reconcile(customer, attempt.id);
    expect(result.body.data.state).toBe('REFUND_PENDING');
    let saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (!saved.refundId) throw new Error('Refund identity not persisted'); const refundId = saved.refundId;
    expect((await stripeProvider.retrieveRefund(refundId)).status).toBe('pending'); expect(await state(customer.id, [id])).toEqual(before);
    // pm_card_pendingRefund settles asynchronously at Stripe; observe with bounded, spaced fresh-runner restarts.
    for (let read = 0; saved.state === 'REFUND_PENDING' && read < 30; read++) {
      if (read >= 4) await new Promise(resolve => setTimeout(resolve, 10_000));
      await restartedRunner(attempt.id); saved = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(saved.refundId).toBe(refundId); expect(await state(customer.id, [id])).toEqual(before);
    }
    expect(saved.state).toBe('REFUNDED'); expect((await stripeProvider.retrieveRefund(refundId)).status).toBe('succeeded');
    expect((await stripeProvider.sdk().refunds.list({ payment_intent: attempt.intentId, limit: 10 })).data).toHaveLength(1);
  }, 600000);
});
