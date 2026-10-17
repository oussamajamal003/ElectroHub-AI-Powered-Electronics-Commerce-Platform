/**
 * Task 03.6 real-PostgreSQL lifecycle acceptance, scenarios K-S (PostgreSQL only; no Stripe, no network).
 *
 * Complements A-J (payment.concurrency.postgres.integration.test.ts) with the specification cases A-J does not cover:
 *   K  last-unit inventory race                       (spec 53, row 1)
 *   L  concurrent same-key payment setup               (spec 53, row 2)
 *   M  compensation worker overlap                     (spec 53, row 6; spec 52 compensation)
 *   N  provider acted, reply lost after capture        (spec 54, boundary 6)
 *   O  local acknowledgement fails after capture       (spec 52 "capture success DB-write failure"; spec 54, boundary 6)
 *   P  refund created, reply lost; stable identity     (spec 54, boundary 9)
 *   Q  process dies after the purchase commit, before capture (spec 54, boundary 5)
 *   R  all repository migrations replayed in the run schema, including the refresh-token lineage migration (spec 52)
 *   S  compensation of a historical (pre-ownership) purchase: Cart restoration only into an empty Cart, inactive product parked (spec 52)
 *
 * Every case uses the current submitted-purchase lifecycle (setup, submit, authorize, durable worker) and a fresh worker
 * (a new PaymentService with no memory) for recovery. Runs ONLY in disposable scope, enabled by scripts/payment-pg-disposable.cjs;
 * the target is re-proved here before any write. Provider-dependent behaviour is a scripted double; real Stripe Test Mode
 * behaviour is covered separately by payment.stripe.live.test.ts under its own authorization.
 */
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentService } from '../payment.service.js';
import {
  Barrier, HarnessProvider, assertDisposableRun, assertRunSchemaIsolation, checkoutRequest, createContext, createDatabase,
  disposableMode, faultyDatabase, makeCustomer, makeProduct, settle, startLegacyPurchase, startPurchase, submitAndAuthorize, type DisposableRun,
} from './helpers/payment-postgres-harness.js';

const connectionString = process.env.PAYMENT_PG_TEST_DATABASE_URL ?? '';
const schema = process.env.PAYMENT_PG_DISPOSABLE_SCHEMA ?? '';
const db = createDatabase(connectionString, schema);
const context = createContext(db);
const { cart, inventory } = context;
let run: DisposableRun;

const stockOf = async (productId: string) => (await db.inventory.findUniqueOrThrow({ where: { productId } })).quantity;
const ordersFor = (productId: string) => db.order.count({ where: { items: { some: { productId } } } });

describe.skipIf(!disposableMode)('real PostgreSQL payment lifecycle acceptance K-S (disposable scope)', () => {
  beforeAll(async () => {
    run = await assertDisposableRun();
    await assertRunSchemaIsolation(db, run.schema);
  }, 60_000);
  afterAll(async () => { await db.$disconnect(); });

  it('K — two customers racing for the last unit: exactly one purchase commits and the other authorization is canceled', async () => {
    const productId = await makeProduct(db, 1); const provider = new HarnessProvider();
    const purchases = [];
    for (const userId of [await makeCustomer(db), await makeCustomer(db)]) purchases.push(await startPurchase(context, userId, productId, provider));
    for (const purchase of purchases) await submitAndAuthorize(purchase, provider);
    const barrier = new Barrier(2);
    await Promise.allSettled(purchases.map(async purchase => { await barrier.wait(); return purchase.payment.process(purchase.attempt.id); }));
    const finals = [];
    for (const purchase of purchases) finals.push(await settle(db, purchase.payment, purchase.attempt.id));

    expect(finals.map(attempt => attempt.state).sort()).toEqual(['CANCELED', 'PAID']);
    expect(await stockOf(productId)).toBe(0);
    expect(await ordersFor(productId)).toBe(1);
    expect(provider.captured).toBe(1);
    expect(provider.callCounts.cancel).toBe(1);
    const winner = finals.find(attempt => attempt.state === 'PAID')!;
    expect(winner.orderId).not.toBeNull();
    expect(finals.find(attempt => attempt.state === 'CANCELED')!.orderId).toBeNull();
  });

  it('L — concurrent setup with the same key creates one attempt and one provider intent', async () => {
    const productId = await makeProduct(db, 50); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    await cart.add(userId, { productId, quantity: 1 });
    const input = checkoutRequest((await cart.get(userId)).revision); const key = randomUUID();
    const payment = new PaymentService(db, provider, inventory); const barrier = new Barrier(2);
    const outcomes = await Promise.allSettled([0, 1].map(async () => { await barrier.wait(); return payment.setup(userId, key, input); }));
    const replay = await payment.setup(userId, key, input);

    const ids = new Set([...outcomes.flatMap(outcome => (outcome.status === 'fulfilled' ? [outcome.value.attemptId] : [])), replay.attemptId]);
    expect(outcomes.some(outcome => outcome.status === 'fulfilled')).toBe(true);
    expect(ids.size).toBe(1);
    expect(await db.paymentAttempt.count({ where: { userId } })).toBe(1);
    // A repeated create with the same attempt identity is idempotent at the provider; what matters is ONE intent.
    expect(provider.callCounts.create).toBeGreaterThanOrEqual(1);
    expect(provider.intents.size).toBe(1);
  });

  it('M — a second runner compensating while the first is stalled restores stock exactly once and the stalled runner is fenced out', async () => {
    const productId = await makeProduct(db, 10); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider, 3);
    await submitAndAuthorize(purchase, provider);
    provider.fail('capture-rejected');
    const stall = provider.stallRetrieveAfterNextCancel();
    const first = purchase.payment.process(purchase.attempt.id);
    await stall.entered;
    expect(await stockOf(productId)).toBe(7); // the purchase committed; the first runner is stalled before compensation
    await db.paymentWork.update({ where: { attemptId: purchase.attempt.id }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
    const second = new PaymentService(db, provider, inventory);
    await second.process(purchase.attempt.id);
    stall.release(); await first;

    const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
    const order = await db.order.findUniqueOrThrow({ where: { userId_checkoutAttemptId: { userId, checkoutAttemptId: purchase.attempt.idempotencyKey } } });
    expect(attempt.state).toBe('COMPENSATED');
    expect(attempt.compensatedAt).not.toBeNull();
    expect(await stockOf(productId)).toBe(10); // restored once, never 13
    expect(order.status).toBe('CANCELLED');
    expect(await db.payment.count({ where: { orderId: order.id, status: 'FAILED' } })).toBe(1);
    expect(provider.captured).toBe(0);
    expect(provider.callCounts.cancel).toBe(1);
    expect((await cart.get(userId)).items).toHaveLength(0); // a submitted purchase never merges into Cart B
  });

  it('N — the provider captured but the reply was lost: a fresh runner reads provider truth and never captures twice', async () => {
    const productId = await makeProduct(db, 20); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider);
    await submitAndAuthorize(purchase, provider);
    provider.fail('capture-reply-lost');
    await purchase.payment.process(purchase.attempt.id);
    expect(provider.captured).toBe(1);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).state).not.toBe('PAID');

    const fresh = new PaymentService(db, provider, inventory);
    const final = await settle(db, fresh, purchase.attempt.id);
    expect(final.state).toBe('PAID');
    expect(provider.captured).toBe(1);
    expect(provider.callCounts.capture).toBe(1);
    expect(await ordersFor(productId)).toBe(1);
    expect(await db.payment.count({ where: { order: { items: { some: { productId } } }, status: 'SUCCEEDED' } })).toBe(1);
    expect(await stockOf(productId)).toBe(19);
  });

  it('O — the local acknowledgement fails after a real capture: a fresh runner finishes from the existing provider state without recapture', async () => {
    const productId = await makeProduct(db, 20); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider);
    await submitAndAuthorize(purchase, provider);
    let armed = true;
    const flaky = faultyDatabase(db, () => { if (armed && provider.captured > 0) { armed = false; return true; } return false; });
    await new PaymentService(flaky, provider, inventory).process(purchase.attempt.id);
    expect(armed).toBe(false); // the injected local write failure really fired after the provider captured
    expect(provider.captured).toBe(1);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).state).not.toBe('PAID');
    expect(await ordersFor(productId)).toBe(1); // the purchase commit was already durable

    const final = await settle(db, new PaymentService(db, provider, inventory), purchase.attempt.id);
    expect(final.state).toBe('PAID');
    expect(provider.callCounts.capture).toBe(1);
    expect(await stockOf(productId)).toBe(19);
  });

  it('P — a refund whose reply was lost resumes with the same identity: one refund, recorded once', async () => {
    const productId = await makeProduct(db, 20); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider);
    await purchase.payment.submit(userId, purchase.attempt.id);
    provider.setStatus(purchase.attempt.id, 'succeeded'); // an unexpected capture with no purchasable order
    provider.fail('refund-reply-lost');
    await purchase.payment.process(purchase.attempt.id);
    expect(provider.refunds.size).toBe(1);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).refundId).toBeNull();

    const final = await settle(db, new PaymentService(db, provider, inventory), purchase.attempt.id);
    expect(final.state).toBe('REFUNDED');
    expect(final.refundId).toBe([...provider.refunds.keys()][0]);
    expect(provider.refunds.size).toBe(1);
    expect(final.refundAmountCents).toBe(final.amountCents);
    expect(await ordersFor(productId)).toBe(0);
    expect(await stockOf(productId)).toBe(20);
  });

  it('Q — the process dies after the purchase commit and before capture: a fresh runner captures exactly once', async () => {
    const productId = await makeProduct(db, 20); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider);
    await submitAndAuthorize(purchase, provider);
    provider.fail('capture-before');
    await purchase.payment.process(purchase.attempt.id);
    expect(provider.captured).toBe(0);
    expect(await ordersFor(productId)).toBe(1);
    expect(await stockOf(productId)).toBe(19);

    const final = await settle(db, new PaymentService(db, provider, inventory), purchase.attempt.id);
    expect(final.state).toBe('PAID');
    expect(provider.captured).toBe(1);
    expect(await ordersFor(productId)).toBe(1);
    expect(await stockOf(productId)).toBe(19);
  });

  it('S — compensating a historical purchase restores the Cart only into an empty Cart and parks the rest in the saved remainder', async () => {
    // Current attempts must be submitted before commit (PAYMENT_SUBMISSION_REQUIRED) and never merge into the Cart; Cart restoration
    // remains live only for historical attempts without a cart-line marker. Both reachable restoration branches are checked.
    const compensateWhileStalled = async (userId: string, lines: Array<{ productId: string; quantity: number }>, duringStall: () => Promise<void>) => {
      const provider = new HarnessProvider();
      const purchase = await startLegacyPurchase(context, userId, lines, provider);
      provider.setStatus(purchase.attempt.id, 'requires_capture'); // authorized without a submit step: the legacy path
      provider.fail('capture-rejected');
      const stall = provider.stallRetrieveAfterNextCancel();
      const running = purchase.payment.process(purchase.attempt.id);
      await stall.entered;
      expect((await cart.get(userId)).items).toHaveLength(0); // committed: the Cart was cleared with the purchase
      await duringStall();
      stall.release(); await running;
      return { attempt: await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } }), provider, purchase };
    };

    // Branch 1: empty Cart, one product retired meanwhile -> the active line returns to the Cart, the retired line is parked.
    const [active, retired] = [await makeProduct(db, 20), await makeProduct(db, 20)]; const first = await makeCustomer(db);
    const one = await compensateWhileStalled(first, [{ productId: active, quantity: 2 }, { productId: retired, quantity: 3 }],
      async () => { expect(await stockOf(active)).toBe(18); expect(await stockOf(retired)).toBe(17);
        await db.product.update({ where: { id: retired }, data: { status: 'INACTIVE' } }); });
    expect(one.attempt.state).toBe('COMPENSATED');
    expect(one.attempt.submittedAt).toBeNull();
    expect(one.attempt.compensatedAt).not.toBeNull();
    expect((await cart.get(first)).items.map(item => [item.productId, item.quantity])).toEqual([[active, 2]]);
    expect(one.attempt.recoveryRemainder).toEqual([{ productId: retired, quantity: 3 }]);
    expect(await stockOf(active)).toBe(20); expect(await stockOf(retired)).toBe(20);
    expect(one.provider.captured).toBe(0); expect(one.provider.callCounts.cancel).toBe(1);
    expect((await db.order.findFirstOrThrow({ where: { items: { some: { productId: active } } } })).status).toBe('CANCELLED');

    // Branch 2: a newer item was added meanwhile -> the Cart is not empty, nothing merges, the whole line is parked.
    const [lone, newer] = [await makeProduct(db, 20), await makeProduct(db, 20)]; const second = await makeCustomer(db);
    const two = await compensateWhileStalled(second, [{ productId: lone, quantity: 2 }],
      async () => { await cart.add(second, { productId: newer, quantity: 1 }); });
    expect(two.attempt.state).toBe('COMPENSATED');
    expect((await cart.get(second)).items.map(item => [item.productId, item.quantity])).toEqual([[newer, 1]]);
    expect(two.attempt.recoveryRemainder).toEqual([{ productId: lone, quantity: 2 }]);
    expect(await stockOf(lone)).toBe(20);
    expect(two.provider.captured).toBe(0);
  });

  it('R — every repository migration is replayed in the run schema, including the refresh-token lineage migration', async () => {
    const root = path.resolve(process.cwd(), 'prisma/migrations');
    const expected = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(path.join(root, entry.name, 'migration.sql'))).map(entry => entry.name).sort();
    const ledger = await db.$queryRaw<Array<{ migration_name: string }>>(Prisma.sql`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    // Sorted in JavaScript on both sides: database collation must not decide the comparison.
    expect(ledger.map(row => row.migration_name).sort()).toEqual(expected);
    expect(expected).toContain('20261013000000_refresh_token_rotation_lineage');

    const columns = await db.$queryRaw<Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>>(Prisma.sql`
      SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = ${run.schema} AND table_name = 'refresh_tokens' AND column_name IN ('familyId', 'replacedByTokenHash')`);
    const family = columns.find(column => column.column_name === 'familyId');
    expect(family).toMatchObject({ data_type: 'uuid', is_nullable: 'NO', column_default: null });
    expect(columns.find(column => column.column_name === 'replacedByTokenHash')).toMatchObject({ is_nullable: 'YES' });
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>(Prisma.sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${run.schema} AND tablename = 'refresh_tokens'`);
    expect(indexes.map(index => index.indexname)).toEqual(expect.arrayContaining(['refresh_tokens_familyId_idx', 'refresh_tokens_replacedByTokenHash_key']));
    const checks = await db.$queryRaw<Array<{ conname: string }>>(Prisma.sql`
      SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${run.schema} AND t.relname = 'refresh_tokens' AND c.contype = 'c'`);
    expect(checks.map(check => check.conname)).toContain('refresh_tokens_no_self_replacement_check');
  });
});
