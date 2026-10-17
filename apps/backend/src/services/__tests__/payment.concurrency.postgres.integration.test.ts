import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, ProductStatus, InventoryStatus, UserRole, type PaymentAttempt, type PaymentAttemptItem } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CartService } from '../cart.service.js';
import { InventoryService } from '../inventory.service.js';
import { OrderService } from '../order.service.js';
import { PaymentService } from '../payment.service.js';
import { createStripeWebhookRouter } from '../../routes/stripe-webhook.routes.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { isSerializationConflict } from '../transaction-conflict.js';
import { assertDisposableRun, assertRunSchemaIsolation, disposableMode } from './helpers/payment-postgres-harness.js';
import type { PaymentProvider, ProviderIntent, ProviderRefund } from '../payment.domain.js';

// '1' is the DEV isolated-schema scope (unchanged guard below); 'disposable' is the separate disposable-instance scope.
const enabled = process.env.PAYMENT_PG_TEST_INTERNAL_RUN === '1' || disposableMode;
const PROJECT_REF = 'pzxekjybdiulzmssalfo';
const DATABASE = 'postgres';
const SCHEMA = 'electrohub_payment_concurrency_20261012';
const ROLE = 'eh_payment_concurrency_runner';
const SCOPE = `DEV:${PROJECT_REF}:${SCHEMA}:${ROLE}:migrate-deploy+fixtures+scenarios-A-J+drop`;
const connectionString = process.env.PAYMENT_PG_TEST_DATABASE_URL ?? '';

type Gate = { entered: Promise<void>; release(): void };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class Barrier {
  private count = 0;
  private readonly gate = deferred();
  constructor(private readonly parties: number) {}
  async wait() {
    this.count++;
    if (this.count === this.parties) this.gate.resolve();
    await this.gate.promise;
  }
}

class LocalPaymentProvider implements PaymentProvider {
  readonly accountId = 'acct_pg_concurrency_mock';
  readonly intents = new Map<string, ProviderIntent>();
  readonly attempts = new Map<string, string>();
  readonly callCounts = { account: 0, create: 0, retrieve: 0, capture: 0, cancel: 0, refund: 0, retrieveRefund: 0 };
  private readonly retrievalGates = new Map<string, { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }>();

  async account() { this.callCounts.account++; return this.accountId; }
  async create(attempt: PaymentAttempt & { items: PaymentAttemptItem[] }): Promise<ProviderIntent> {
    this.callCounts.create++;
    const id = `pi_mock_${attempt.id.replaceAll('-', '')}`;
    const intent: ProviderIntent = { id, account: this.accountId, livemode: false, amount: attempt.amountCents,
      currency: attempt.currency.toLowerCase(), captureMethod: 'manual', status: 'requires_payment_method', capturable: 0,
      received: 0, methodType: 'card', clientSecret: `mock-client-${attempt.id}`, attemptId: attempt.id,
      declined: false, card: null, captureBefore: new Date(Date.now() + 60 * 60_000) };
    this.intents.set(id, intent); this.attempts.set(attempt.id, id); return { ...intent };
  }
  async retrieve(id: string) {
    this.callCounts.retrieve++;
    const gate = this.retrievalGates.get(id);
    if (gate) { this.retrievalGates.delete(id); gate.entered.resolve(); await gate.release.promise; }
    const intent = this.intents.get(id);
    if (!intent) throw new Error('Mock provider received an unknown intent id.');
    return { ...intent };
  }
  async capture(attempt: PaymentAttempt & { items: PaymentAttemptItem[] }) {
    this.callCounts.capture++;
    const id = this.attempts.get(attempt.id);
    const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider capture did not match its saved attempt.');
    const succeeded = { ...intent, status: 'succeeded', capturable: 0, received: attempt.amountCents };
    this.intents.set(succeeded.id, succeeded); return { ...succeeded };
  }
  async cancel(attempt: PaymentAttempt & { items: PaymentAttemptItem[] }) {
    this.callCounts.cancel++;
    const id = this.attempts.get(attempt.id); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider cancel did not match its saved attempt.');
    const canceled = { ...intent, status: 'canceled', capturable: 0, received: 0 };
    this.intents.set(canceled.id, canceled); return { ...canceled };
  }
  async refund(_attempt: PaymentAttempt & { items: PaymentAttemptItem[] }, amount: number): Promise<ProviderRefund> {
    this.callCounts.refund++; return { id: 're_mock_local', intentId: 'pi_mock_local', amount, status: 'succeeded' };
  }
  async retrieveRefund(id: string): Promise<ProviderRefund> {
    this.callCounts.retrieveRefund++; return { id, intentId: 'pi_mock_local', amount: 0, status: 'succeeded' };
  }
  setStatus(attemptId: string, status: ProviderIntent['status']) {
    const id = this.attempts.get(attemptId); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider status update did not match its saved attempt.');
    const next = status === 'requires_capture'
      ? { ...intent, status, capturable: intent.amount, received: 0 }
      : status === 'succeeded' ? { ...intent, status, capturable: 0, received: intent.amount }
        : { ...intent, status };
    this.intents.set(id!, next);
  }
  intentFor(attemptId: string) {
    const id = this.attempts.get(attemptId); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider has no intent for the saved attempt.');
    return { ...intent };
  }
  blockNextRetrieve(intentId: string): Gate {
    const entered = deferred(); const release = deferred();
    this.retrievalGates.set(intentId, { entered, release });
    return { entered: entered.promise, release: release.resolve };
  }
}

const tlsUrl = connectionString ? new URL(connectionString) : null;
for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) tlsUrl?.searchParams.delete(name);
const prismaAdapter = new PrismaPg({ connectionString: tlsUrl?.toString() ?? '', max: 4, min: 0, connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000, statement_timeout: 30_000, lock_timeout: 5_000,
  ssl: { rejectUnauthorized: true } }, { schema: disposableMode ? process.env.PAYMENT_PG_DISPOSABLE_SCHEMA ?? '' : SCHEMA });
const db = new PrismaClient({ adapter: prismaAdapter, log: ['error'] });
const inventory = new InventoryService();
const cart = new CartService(db);

type Fixture = { userId: string; categoryId: string; productIds: string[] };
async function fixture(productCount = 2): Promise<Fixture> {
  const role = await db.role.upsert({ where: { name: UserRole.CUSTOMER }, create: { name: UserRole.CUSTOMER }, update: {} });
  const unique = randomUUID().replaceAll('-', '');
  const category = await db.category.create({ data: { name: `PG concurrency ${unique}`, slug: `pg-concurrency-${unique}` } });
  const user = await db.user.create({ data: { roleId: role.id, email: `pg-concurrency-${unique}@example.invalid`,
    firstName: 'Postgres', lastName: 'Fixture' } });
  const productIds: string[] = [];
  for (let index = 0; index < productCount; index++) {
    const product = await db.product.create({ data: { categoryId: category.id, sku: `PG-${unique}-${index}`,
      name: `Disposable product ${index}`, slug: `pg-${unique}-${index}`, price: new Prisma.Decimal('12.34'),
      status: ProductStatus.ACTIVE, storefrontVisible: true, isTestFixture: false,
      images: { create: { url: 'https://example.invalid/payment-concurrency-fixture.png', isPrimary: true } },
      inventory: { create: { quantity: 50, lowStockAt: 5, status: InventoryStatus.IN_STOCK } } }, select: { id: true } });
    productIds.push(product.id);
  }
  return { userId: user.id, categoryId: category.id, productIds };
}

const checkoutAddress = { recipient: 'Disposable Acceptance', line1: '1 Test Avenue', city: 'Seoul',
  postalCode: '04524', country: 'South Korea', phone: '+821012345678' };
async function startPurchase(userId: string, productId: string, provider: LocalPaymentProvider, quantity = 1) {
  await cart.add(userId, { productId, quantity });
  const activeCart = await cart.get(userId);
  const payment = new PaymentService(db, provider, inventory);
  const setup = await payment.setup(userId, randomUUID(), { shipping: checkoutAddress,
    deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: activeCart.revision });
  const attempt = await db.paymentAttempt.findUnique({ where: { id: setup.attemptId }, include: { items: true } });
  if (!attempt) throw new Error('PaymentService.setup did not persist its checkout attempt.');
  return { payment, setup, attempt, provider };
}

/**
 * PostgreSQL SQLSTATE of a Prisma 6 driver-adapter error. Observed on real PostgreSQL 17 (2026-10-15): generic errors carry
 * the SQLSTATE in meta.code (23514, P0001 from raw SQL); adapter-pg maps 23505 to "Unique constraint failed" with code N/A and
 * 40001/40P01 to P2034; errors raised inside model queries surface as PrismaClientUnknownRequestError whose message embeds the
 * PostgresError code. Prisma's own codes (P1xxx–P6xxx) are never returned as a SQLSTATE.
 */
function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown }; cause?: { code?: unknown } };
  const isSqlState = (value: unknown): value is string => typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) && !/^P[1-6]\d{3}$/.test(value);
  for (const value of [record.meta?.code, record.cause?.code, record.code]) if (isSqlState(value)) return value;
  if (typeof record.meta?.message === 'string' && record.meta.message.startsWith('Unique constraint failed')) return '23505';
  const embedded = typeof record.message === 'string' ? /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(record.message)?.[1] : undefined;
  return isSqlState(embedded) ? embedded : undefined;
}

async function makeWebhookApp(database: PrismaClient) {
  const secret = 'whsec_local_signature_fixture_only';
  const localStripe = new Stripe('sk_test_local_signature_only');
  const router = createStripeWebhookRouter({ database, webhookSecret: secret,
    constructEvent: (payload: Buffer, signature: string, signingSecret: string) => localStripe.webhooks.constructEvent(payload, signature, signingSecret),
    account: async () => 'acct_pg_concurrency_mock' });
  const app = express(); app.use(router); app.use(express.json()); app.use(errorHandler);
  async function deliver(event: Stripe.Event) {
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    // A string body keeps the exact signed bytes; supertest JSON-serializes a Buffer when Content-Type is JSON.
    return request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature).send(payload);
  }
  return deliver;
}

describe.skipIf(!enabled)('real PostgreSQL payment concurrency acceptance A-J', () => {
  beforeAll(async () => {
    if (disposableMode) {
      // Separate scope: the target is re-proved as a disposable instance; the DEV guard below is not weakened or reused.
      const run = await assertDisposableRun();
      await assertRunSchemaIsolation(db, run.schema);
      return;
    }
    if (!connectionString || process.env.PAYMENT_PG_TEST_APPROVED !== 'true' ||
        process.env.PAYMENT_PG_TEST_PROJECT_REF !== PROJECT_REF || process.env.PAYMENT_PG_TEST_SCHEMA !== SCHEMA ||
        process.env.PAYMENT_PG_TEST_ROLE !== ROLE || process.env.PAYMENT_PG_TEST_SCOPE_AUTHORIZATION !== SCOPE ||
        process.env.DATABASE_URL !== connectionString || process.env.DIRECT_URL !== connectionString ||
        process.env.STRIPE_SECRET_KEY !== '') throw new Error('PostgreSQL service suite safety scope failed before fixture writes.');
    const rows = await db.$queryRaw<Array<{ db: string; role: string; login: string; schema: string; schemas: string[]; path: string }>>(Prisma.sql`
      SELECT current_database() AS db, current_user AS role, session_user AS login, current_schema() AS schema,
      current_schemas(false)::text[] AS schemas, current_setting('search_path') AS path`);
    expect(rows[0]).toMatchObject({ db: DATABASE, role: ROLE, login: ROLE, schema: SCHEMA, schemas: [SCHEMA] });
    expect(rows[0]?.path).toBe(SCHEMA);
    for (const table of ['payment_attempts', 'payment_work', 'orders', 'payments', 'carts', 'cart_items']) {
      await expect(db.$queryRawUnsafe(`SELECT 1 FROM public."${table}" LIMIT 0`)).rejects.toSatisfy(error => sqlState(error) === '42501');
    }
  }, 30_000);

  afterAll(async () => { await db.$disconnect(); });

  it('A — concurrent submits transfer exactly one saved Cart generation', async () => {
    const seed = await fixture(1); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    const attemptId = purchase.attempt.id; const lineId = purchase.attempt.items[0]!.snapshotCartItemId!;
    const barrier = new Barrier(2);
    const results = await Promise.all([0, 1].map(async () => { await barrier.wait(); return purchase.payment.submit(seed.userId, attemptId); }));
    expect(results).toHaveLength(2);
    const [saved, item, activeLines] = await Promise.all([
      db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
      db.paymentAttemptItem.findMany({ where: { attemptId } }),
      db.cartItem.findMany({ where: { cart: { userId: seed.userId } } }),
    ]);
    expect(saved.submittedAt).not.toBeNull(); expect(saved.activeCartId).toBeNull();
    expect(item).toHaveLength(1); expect(item[0]?.sourceCartItemId).toBe(lineId); expect(activeLines).toHaveLength(0);
  });

  it('B — submit racing a real CartService mutation either commits first or rolls back cleanly', async () => {
    const seed = await fixture(2); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    const attemptId = purchase.attempt.id; const barrier = new Barrier(2);
    const [submitted, added] = await Promise.allSettled([
      (async () => { await barrier.wait(); return purchase.payment.submit(seed.userId, attemptId); })(),
      (async () => { await barrier.wait(); return cart.add(seed.userId, { productId: seed.productIds[1]!, quantity: 1 }); })(),
    ]);
    expect(added.status).toBe('fulfilled');
    const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { items: true } });
    const lines = await db.cartItem.findMany({ where: { cart: { userId: seed.userId } }, orderBy: { createdAt: 'asc' } });
    if (submitted.status === 'fulfilled') {
      expect(attempt.submittedAt).not.toBeNull(); expect(attempt.items[0]?.sourceCartItemId).not.toBeNull();
      expect(lines.map(line => line.productId)).toEqual([seed.productIds[1]]);
    } else {
      const state = sqlState(submitted.reason);
      expect((submitted.reason as { code?: string })?.code === 'CHECKOUT_CHANGED' || state === '40001' || state === '40P01' ||
        isSerializationConflict(submitted.reason)).toBe(true);
      expect(attempt.submittedAt).toBeNull(); expect(attempt.items[0]?.sourceCartItemId).toBeNull();
      expect(lines.map(line => line.productId).sort()).toEqual([seed.productIds[0]!, seed.productIds[1]!].sort());
    }
  });

  it('C — A continues while Product B is added and prepared as Checkout B', async () => {
    const seed = await fixture(2); const provider = new LocalPaymentProvider();
    const purchaseA = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    await purchaseA.payment.submit(seed.userId, purchaseA.attempt.id);
    provider.setStatus(purchaseA.attempt.id, 'requires_capture');
    const gate = provider.blockNextRetrieve(purchaseA.attempt.providerIntentId!);
    const processingA = purchaseA.payment.process(purchaseA.attempt.id);
    await gate.entered;
    await cart.add(seed.userId, { productId: seed.productIds[1]!, quantity: 2 });
    const cartB = await cart.get(seed.userId);
    const setupB = await purchaseA.payment.setup(seed.userId, randomUUID(), { shipping: checkoutAddress,
      deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cartB.revision });
    gate.release(); await processingA;
    const [active, attemptB, orderA, productB] = await Promise.all([
      cart.get(seed.userId), db.paymentAttempt.findUniqueOrThrow({ where: { id: setupB.attemptId }, include: { items: true } }),
      db.order.findUniqueOrThrow({ where: { userId_checkoutAttemptId: { userId: seed.userId,
        checkoutAttemptId: purchaseA.attempt.idempotencyKey } }, include: { items: true } }),
      db.product.findUniqueOrThrow({ where: { id: seed.productIds[1] } }),
    ]);
    expect(active.items.map(item => item.productId)).toEqual([seed.productIds[1]]);
    expect(active.subtotal).toBe(productB.price.mul(2).toFixed(2));
    expect(attemptB.items.map(item => item.productId)).toEqual([seed.productIds[1]]);
    expect(setupB.clientSecret).toBe(provider.intentFor(setupB.attemptId).clientSecret);
    expect(orderA.items.map(item => item.productId)).toEqual([seed.productIds[0]]);
    expect(provider.callCounts.capture).toBe(1);
  });

  it('D — same SKU added after submit has a new line identity and remains in Cart', async () => {
    const seed = await fixture(1); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider, 2);
    const originalLine = purchase.attempt.items[0]!.snapshotCartItemId!;
    await purchase.payment.submit(seed.userId, purchase.attempt.id);
    await cart.add(seed.userId, { productId: seed.productIds[0]!, quantity: 3 });
    const newLine = await db.cartItem.findFirstOrThrow({ where: { cart: { userId: seed.userId } } });
    expect(newLine.id).not.toBe(originalLine);
    provider.setStatus(purchase.attempt.id, 'requires_capture');
    await purchase.payment.process(purchase.attempt.id);
    const [savedItem, remaining, stock] = await Promise.all([
      db.paymentAttemptItem.findFirstOrThrow({ where: { attemptId: purchase.attempt.id } }),
      cart.get(seed.userId), db.inventory.findUniqueOrThrow({ where: { productId: seed.productIds[0]! } }),
    ]);
    expect(savedItem.sourceCartItemId).toBe(originalLine);
    expect(remaining.items).toHaveLength(1); expect(remaining.items[0]?.id).toBe(newLine.id);
    expect(remaining.items[0]?.quantity).toBe(3); expect(stock.quantity).toBe(48);
  });

  it('E — OrderService commits A without clearing or changing Cart B', async () => {
    const seed = await fixture(2); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    await purchase.payment.submit(seed.userId, purchase.attempt.id);
    await cart.add(seed.userId, { productId: seed.productIds[1]!, quantity: 4 });
    const before = await cart.get(seed.userId);
    provider.setStatus(purchase.attempt.id, 'requires_capture');
    const authorization = provider.intentFor(purchase.attempt.id);
    const token = randomUUID();
    await db.paymentAttempt.update({ where: { id: purchase.attempt.id }, data: { state: 'AUTHORIZED', providerStatus: 'requires_capture' } });
    await db.paymentWork.update({ where: { attemptId: purchase.attempt.id }, data: { state: 'LEASED', leaseToken: token,
      leaseUntil: new Date(Date.now() + 60_000) } });
    const committed = await new OrderService(db, inventory).commitAuthorized(purchase.attempt.id, authorization, token);
    const savedOrder = await db.order.findUniqueOrThrow({ where: { userId_checkoutAttemptId: {
      userId: seed.userId, checkoutAttemptId: purchase.attempt.idempotencyKey } } });
    const after = await cart.get(seed.userId);
    expect(committed.cart.items.map(item => item.productId)).toEqual([seed.productIds[1]]);
    expect(after).toEqual(before);
    expect((await db.orderItem.findMany({ where: { orderId: savedOrder.id } })).map(item => item.productId)).toEqual([seed.productIds[0]]);
  });

  it('F — failure after line transfer writes rolls back every ownership write (SQLSTATE P0001)', async () => {
    const seed = await fixture(1); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    const attemptId = purchase.attempt.id; const originalLine = purchase.attempt.items[0]!.snapshotCartItemId!;
    await db.$executeRawUnsafe(`CREATE FUNCTION "pgtest_raise_after_transfer"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'controlled disposable transaction failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "pgtest_raise_after_transfer" BEFORE UPDATE OF "nextRunAt" ON "payment_work"
      FOR EACH ROW WHEN (NEW."nextRunAt" IS DISTINCT FROM OLD."nextRunAt") EXECUTE FUNCTION "pgtest_raise_after_transfer"()`);
    try {
      let thrown: unknown;
      try { await purchase.payment.submit(seed.userId, attemptId); } catch (error) { thrown = error; }
      expect(sqlState(thrown)).toBe('P0001');
      const [attempt, item, lines] = await Promise.all([
        db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
        db.paymentAttemptItem.findFirstOrThrow({ where: { attemptId } }),
        db.cartItem.findMany({ where: { cart: { userId: seed.userId } } }),
      ]);
      expect(attempt.submittedAt).toBeNull(); expect(attempt.activeCartId).not.toBeNull();
      expect(item.sourceCartItemId).toBeNull(); expect(lines.map(line => line.id)).toEqual([originalLine]);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "pgtest_raise_after_transfer" ON "payment_work"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "pgtest_raise_after_transfer"()`);
    }
  });

  it('G — stale PaymentWork lease cannot commit an order or capture', async () => {
    const seed = await fixture(1); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    await purchase.payment.submit(seed.userId, purchase.attempt.id);
    provider.setStatus(purchase.attempt.id, 'requires_capture');
    const gate = provider.blockNextRetrieve(purchase.attempt.providerIntentId!);
    const staleWorker = purchase.payment.process(purchase.attempt.id);
    await gate.entered;
    const newToken = randomUUID();
    await db.paymentWork.update({ where: { attemptId: purchase.attempt.id }, data: { leaseToken: newToken,
      leaseUntil: new Date(Date.now() + 60_000) } });
    gate.release(); await staleWorker;
    const [work, attempt, orders, inventoryRow] = await Promise.all([
      db.paymentWork.findUniqueOrThrow({ where: { attemptId: purchase.attempt.id } }),
      db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } }),
      db.order.count({ where: { userId: seed.userId, checkoutAttemptId: purchase.attempt.idempotencyKey } }),
      db.inventory.findUniqueOrThrow({ where: { productId: seed.productIds[0]! } }),
    ]);
    expect(work.leaseToken).toBe(newToken); expect(work.state).toBe('LEASED');
    expect(attempt.orderId).toBeNull(); expect(orders).toBe(0); expect(inventoryRow.quantity).toBe(50);
    expect(provider.callCounts.capture).toBe(0);
    // A crashed owner cannot strand the authorized purchase after its lease expires.
    await db.paymentWork.update({ where: { attemptId: purchase.attempt.id }, data: { leaseUntil: new Date(Date.now() - 1) } });
    await purchase.payment.runBatch([purchase.attempt.id]);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).state).toBe('PAID');
    expect(provider.callCounts.capture).toBe(1);
  });

  it('H — duplicate webhook and processor deliveries create one order/payment/capture/stock decrement', async () => {
    const seed = await fixture(1); const provider = new LocalPaymentProvider();
    const purchase = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    await purchase.payment.submit(seed.userId, purchase.attempt.id);
    provider.setStatus(purchase.attempt.id, 'requires_capture');
    const deliver = await makeWebhookApp(db);
    const event: Stripe.Event = { id: `evt_${randomUUID().replaceAll('-', '')}`, object: 'event', api_version: null,
      created: Math.floor(Date.now() / 1000), data: { object: { id: purchase.attempt.providerIntentId!, object: 'payment_intent' } as Stripe.PaymentIntent },
      livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type: 'payment_intent.amount_capturable_updated' };
    expect((await deliver(event)).status).toBe(200); expect((await deliver(event)).status).toBe(200);
    expect(await db.stripeEvent.count({ where: { id: event.id } })).toBe(1);

    const gate = provider.blockNextRetrieve(purchase.attempt.providerIntentId!);
    const first = purchase.payment.process(purchase.attempt.id);
    await gate.entered;
    expect(await purchase.payment.process(purchase.attempt.id)).toBeNull();
    gate.release(); await first;

    const lateEvent: Stripe.Event = { ...event, id: `evt_${randomUUID().replaceAll('-', '')}`, type: 'payment_intent.processing' };
    expect((await deliver(lateEvent)).status).toBe(200); expect((await deliver(lateEvent)).status).toBe(200);
    await purchase.payment.process(purchase.attempt.id);
    const savedOrder = await db.order.findUniqueOrThrow({ where: { userId_checkoutAttemptId: {
      userId: seed.userId, checkoutAttemptId: purchase.attempt.idempotencyKey } } });
    const [orders, payments, items, stock, events, attempt] = await Promise.all([
      db.order.count({ where: { userId: seed.userId, checkoutAttemptId: purchase.attempt.idempotencyKey } }),
      db.payment.count({ where: { orderId: savedOrder.id } }),
      db.orderItem.count({ where: { orderId: savedOrder.id } }),
      db.inventory.findUniqueOrThrow({ where: { productId: seed.productIds[0]! } }),
      db.stripeEvent.count({ where: { attemptId: purchase.attempt.id } }),
      db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } }),
    ]);
    expect(orders).toBe(1); expect(payments).toBe(1); expect(items).toBe(1); expect(stock.quantity).toBe(49);
    expect(events).toBe(2); expect(attempt.state).toBe('PAID'); expect(provider.callCounts.capture).toBe(1);

    // The same Intent can be retried after a genuine decline. If its webhook is
    // missed and the browser closes, a DONE work row must still be discoverable.
    const retry = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    await retry.payment.submit(seed.userId, retry.attempt.id);
    const declinedIntent = provider.intentFor(retry.attempt.id);
    provider.intents.set(declinedIntent.id, { ...declinedIntent, declined: true });
    await retry.payment.process(retry.attempt.id);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: retry.attempt.id } })).state).toBe('DECLINED');
    expect((await db.paymentWork.findUniqueOrThrow({ where: { attemptId: retry.attempt.id } })).state).toBe('DONE');
    provider.setStatus(retry.attempt.id, 'requires_capture');
    await db.paymentWork.update({ where: { attemptId: retry.attempt.id }, data: { nextRunAt: new Date(0) } });
    await retry.payment.runBatch([retry.attempt.id]);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: retry.attempt.id } })).state).toBe('PAID');
    expect(provider.callCounts.capture).toBe(2);
    expect(await db.order.count({ where: { userId: seed.userId } })).toBe(2);
    expect((await db.inventory.findUniqueOrThrow({ where: { productId: seed.productIds[0]! } })).quantity).toBe(48);
  });

  it('I — real migration unique and CHECK constraints reject invalid ownership (23505/23514)', async () => {
    const seed = await fixture(2); const provider = new LocalPaymentProvider();
    const purchaseA = await startPurchase(seed.userId, seed.productIds[0]!, provider);
    await purchaseA.payment.submit(seed.userId, purchaseA.attempt.id);
    await cart.add(seed.userId, { productId: seed.productIds[1]!, quantity: 1 });
    const purchaseB = await purchaseA.payment.setup(seed.userId, randomUUID(), { shipping: checkoutAddress,
      deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: (await cart.get(seed.userId)).revision });
    const savedLine = (await db.paymentAttemptItem.findFirstOrThrow({ where: { attemptId: purchaseA.attempt.id } })).sourceCartItemId!;
    const itemB = await db.paymentAttemptItem.findFirstOrThrow({ where: { attemptId: purchaseB.attemptId } });
    let duplicateLineError: unknown;
    try { await db.$executeRaw(Prisma.sql`UPDATE "payment_attempt_items" SET "sourceCartItemId" = ${savedLine}::uuid WHERE "id" = ${itemB.id}::uuid`); }
    catch (error) { duplicateLineError = error; }
    expect(sqlState(duplicateLineError)).toBe('23505');

    const cartRow = await db.cart.findUniqueOrThrow({ where: { userId: seed.userId } });
    let checkError: unknown;
    try { await db.$executeRaw(Prisma.sql`UPDATE "payment_attempts" SET "submittedAt" = CURRENT_TIMESTAMP,
      "activeCartId" = ${cartRow.id}::uuid WHERE "id" = ${purchaseB.attemptId}::uuid`); }
    catch (error) { checkError = error; }
    expect(sqlState(checkError)).toBe('23514');
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchaseB.attemptId } })).submittedAt).toBeNull();
  });

  it('J — Prisma Serializable transactions surface a real SQLSTATE 40001 and roll back write skew', async () => {
    const seed = await fixture(1); const other = await fixture(1);
    const barrier = new Barrier(2);
    const transactions = [seed.userId, other.userId].map((writeUserId, index) => db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" IN (${seed.userId}::uuid, ${other.userId}::uuid) ORDER BY "id"`);
      await barrier.wait();
      await tx.user.update({ where: { id: writeUserId }, data: { firstName: `Serializable ${index}` } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 }));
    const outcomes = await Promise.allSettled(transactions);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    expect(rejected).toHaveLength(1);
    // adapter-pg reports SQLSTATE 40001 as P2034; the production classifier is what the services rely on for retries.
    // The server log of the disposable instance records the underlying 40001 (see the acceptance handoff).
    expect(isSerializationConflict(rejected[0]?.reason)).toBe(true);
    expect((rejected[0]?.reason as { code?: string }).code).toBe('P2034');
    const users = await db.user.findMany({ where: { id: { in: [seed.userId, other.userId] } }, select: { firstName: true } });
    expect(users.filter(user => user.firstName.startsWith('Serializable'))).toHaveLength(1);
  });
});
