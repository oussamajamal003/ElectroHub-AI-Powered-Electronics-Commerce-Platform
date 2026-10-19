/**
 * Task 03.8 real-PostgreSQL acceptance (DISPOSABLE only; launched by scripts/commerce-email-pg.cjs, skipped everywhere else).
 * Every migration (19 historical + 20261018000000_commerce_email_outbox) is applied by `prisma migrate deploy` before this runs.
 * Payment flows use the real PaymentService/OrderService against PostgreSQL with the scripted Stripe double (no network);
 * dispatch uses an in-memory transport double (no Brevo). IDs map to the task's T01–T25 and DB01–DB10.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentService } from '../payment.service.js';
import { OrderService } from '../order.service.js';
import { enqueuePaymentSucceeded, transitionFulfillment } from '../commerce-email.producer.js';
import { CommerceEmailDispatcher, type CommerceEmailTransport, type OutgoingCommerceEmail } from '../commerce-email.dispatcher.js';
import { commerceEmailSnapshot, type ProviderSendResult } from '../commerce-email.domain.js';
import { renderCommerceEmail } from '../../emails/commerce/templates.js';
import { Barrier, HarnessProvider, createContext, createDatabase, deferred, faultyDatabase, makeCustomer, makeProduct, settle,
  startPurchase, submitAndAuthorize } from './helpers/payment-postgres-harness.js';
import type { Attempt, ProviderRefund } from '../payment.domain.js';

const enabled = process.env.COMMERCE_EMAIL_PG_RUN === '1';
const url = process.env.DATABASE_URL ?? '';
const db = enabled ? createDatabase(url, 'public') : (null as unknown as PrismaClient);
const context = enabled ? createContext(db) : null!;
const config = { sendMode: 'live' as const, allowedRecipients: [], origin: 'http://localhost:5173', batchSize: 10, concurrency: 2, leaseMs: 60_000 };

class FailingRefundProvider extends HarnessProvider {
  override async refund(attempt: Attempt, amount: number): Promise<ProviderRefund> {
    const refund = await super.refund(attempt, amount);
    this.refunds.set(refund.id, { ...refund, status: 'failed' });
    return { ...refund, status: 'failed' };
  }
}
class ScriptedTransport implements CommerceEmailTransport {
  readonly name = 'BREVO' as const;
  readonly sent: OutgoingCommerceEmail[] = [];
  constructor(private readonly next: (message: OutgoingCommerceEmail) => Promise<ProviderSendResult> | ProviderSendResult =
    () => ({ success: true, messageId: `<${randomUUID()}@smtp-relay.mailin.fr>` })) {}
  async send(message: OutgoingCommerceEmail) { this.sent.push(message); return this.next(message); }
}

/** One durable worker pass, exactly as the runner would make due work claimable. */
async function round(payment: PaymentService, attemptId: string) {
  await db.paymentWork.updateMany({ where: { attemptId, state: 'READY' }, data: { nextRunAt: new Date(Date.now() - 1_000) } });
  await payment.process(attemptId);
}
async function authorized(provider = new HarnessProvider()) {
  const userId = await makeCustomer(db); const productId = await makeProduct(db, 5);
  const purchase = await startPurchase(context, userId, productId, provider);
  await submitAndAuthorize(purchase, provider);
  return { ...purchase, provider };
}
async function paid() {
  const purchase = await authorized();
  const attempt = await settle(db, purchase.payment, purchase.attempt.id);
  expect(attempt.state).toBe('PAID');
  return { ...purchase, orderId: attempt.orderId! };
}
const eventsFor = (orderId: string) => db.commerceEmailOutbox.findMany({ where: { orderId }, orderBy: { type: 'asc' } });
const outboxCount = () => db.commerceEmailOutbox.count();
/** A minimal valid READY event for dispatcher tests, attached to a real paid order. */
async function readyEvents(count: number) {
  const { orderId } = await paid();
  await db.commerceEmailOutbox.deleteMany({ where: { orderId } });
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true, user: true } });
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = randomUUID();
    await db.commerceEmailOutbox.create({ data: { id, eventKey: `test:${id}`, type: 'PAYMENT_CONFIRMED', orderId, paymentId: order.payment!.id,
      userId: order.userId, recipient: order.user.email, templateVersion: 'v1', occurredAt: new Date(), nextAttemptAt: new Date(Date.now() - 1_000),
      snapshot: { v: 1, type: 'PAYMENT_CONFIRMED', orderReference: `ORD-${orderId.toUpperCase()}`, occurredAt: new Date().toISOString(),
        recipientName: 'Postgres', amount: order.total.toFixed(2), currency: 'USD', paidAt: new Date().toISOString(), card: null } } });
    ids.push(id);
  }
  return { orderId, ids };
}
const expireLease = (id: string) => db.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "leaseUntil" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "id" = ${id}::uuid`);
const dueNow = (id: string) => db.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "nextAttemptAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "id" = ${id}::uuid`);
const dispatcher = (transport: CommerceEmailTransport, client: PrismaClient = db) => new CommerceEmailDispatcher(client, transport, renderCommerceEmail, config);
const sqlStateOf = async (operation: Promise<unknown>) => {
  try { await operation; return 'NO_ERROR'; }
  catch (error) { const text = String((error as Error)?.message ?? error); return /23514|check constraint|immutable|terminal|cannot be|append-only/i.test(text) ? 'REJECTED' : /23505|Unique constraint|duplicate key/i.test(text) ? 'DUPLICATE' : text; }
};

describe.skipIf(!enabled)('Task 03.8 commerce email — real PostgreSQL', () => {
  beforeAll(async () => {
    // Re-prove the target before any write: loopback host and a disposable database created by the runner.
    const parsed = new URL(url);
    expect(['127.0.0.1', 'localhost']).toContain(parsed.hostname);
    const [row] = await db.$queryRaw<{ name: string; migrations: bigint }[]>(Prisma.sql`SELECT current_database()::text AS "name",
      (SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS "migrations"`);
    expect(row!.name).toMatch(/^electrohub_disposable_email_[0-9a-f]{8}$/);
    expect(Number(row!.migrations)).toBe(20);
  });
  afterAll(async () => { await db?.$disconnect(); });

  describe('producer: authority and atomicity', () => {
    it('T02/DB01/T21: verified finalization commits Payment, Order, Attempt and exactly two distinct immutable events', async () => {
      const { orderId, userId, attempt } = await paid();
      const events = await eventsFor(orderId);
      expect(events.map(event => event.type)).toEqual(['ORDER_CONFIRMED', 'PAYMENT_CONFIRMED']);
      const payment = await db.payment.findUniqueOrThrow({ where: { orderId } });
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      expect(events.map(event => event.eventKey).sort()).toEqual([`order:${orderId}:confirmed`, `payment:${payment.id}:succeeded`].sort());
      for (const event of events) {
        expect(event).toMatchObject({ dispatchState: 'READY', deliveryState: 'UNKNOWN', attemptCount: 0, recipient: user.email.toLowerCase(), userId });
        expect(commerceEmailSnapshot.parse(event.snapshot).occurredAt).toBe(payment.paidAt!.toISOString());
      }
      const order = commerceEmailSnapshot.parse(events[0]!.snapshot);
      if (order.type !== 'ORDER_CONFIRMED') throw new Error('unexpected');
      expect(order).toMatchObject({ total: '12.34', subtotal: '12.34', shipping: '0.00', currency: 'USD', items: [{ unitPrice: '12.34', lineTotal: '12.34', quantity: 1 }] });
      const pay = commerceEmailSnapshot.parse(events[1]!.snapshot);
      expect(pay).toMatchObject({ type: 'PAYMENT_CONFIRMED', amount: '12.34', currency: 'USD' });
      expect(JSON.stringify(pay)).not.toMatch(/line1|recipient"|Test Avenue/);
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('PAID');
    });

    it('T01: an authorized order awaiting capture (and a pending payment) produces zero success events', async () => {
      const purchase = await authorized();
      purchase.provider.fail('capture-before');
      await round(purchase.payment, purchase.attempt.id);
      const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
      const order = await db.order.findUniqueOrThrow({ where: { id: attempt.orderId! }, include: { payment: true } });
      expect(order.status).toBe('AWAITING_CAPTURE');
      expect(order.payment!.status).toBe('PROCESSING');
      expect(await eventsFor(order.id)).toHaveLength(0);
    });

    it('T03/DB03: replayed and concurrent finalization producers create no additional event and keep the first snapshot', async () => {
      const { orderId } = await paid();
      const before = await eventsFor(orderId);
      const barrier = new Barrier(2);
      const replays = await Promise.all([0, 1].map(() => db.$transaction(async tx => {
        await barrier.wait();
        return enqueuePaymentSucceeded(tx, { orderId, paidAt: new Date(Date.now() + 60_000), card: { brand: 'visa', last4: '4242' } });
      })));
      expect(replays.flat().every(created => created === null)).toBe(true);
      const after = await eventsFor(orderId);
      expect(after.map(event => [event.id, event.snapshot])).toEqual(before.map(event => [event.id, event.snapshot]));
    });

    it('T04/T05/DB02: an outbox insert failure rolls finalization back; recovery completes it later without another capture', async () => {
      const purchase = await authorized();
      await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated outbox failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_outbox BEFORE INSERT ON "commerce_email_outbox" FOR EACH ROW EXECUTE FUNCTION test_fail_outbox()`);
      try {
        await round(purchase.payment, purchase.attempt.id);
        const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id }, include: { work: true } });
        const order = await db.order.findUniqueOrThrow({ where: { id: attempt.orderId! }, include: { payment: true } });
        expect(purchase.provider.captured).toBe(1); // the money moved exactly once
        expect(attempt.state).not.toBe('PAID'); // finalization rolled back with its events
        expect(['DECLINED', 'CANCELED', 'COMPENSATED']).not.toContain(attempt.state); // never treated as a decline
        expect(order.payment!.status).toBe('PROCESSING');
        expect(order.status).toBe('AWAITING_CAPTURE');
        expect(attempt.work?.state).toBe('READY'); // recovery remains eligible
        expect(await eventsFor(order.id)).toHaveLength(0);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER test_fail_outbox ON "commerce_email_outbox"');
      }
      const recovered = await settle(db, new PaymentService(db, purchase.provider, context.inventory), purchase.attempt.id);
      expect(recovered.state).toBe('PAID');
      expect(purchase.provider.captured).toBe(1);
      expect(purchase.provider.callCounts.capture).toBe(1);
      expect((await eventsFor(recovered.orderId!)).map(event => event.type)).toEqual(['ORDER_CONFIRMED', 'PAYMENT_CONFIRMED']);
    });

    it('T09/T10/DB10: no usable recipient → durable SUPPRESSED events with NULL recipient; payment still succeeds; never dispatchable', async () => {
      const purchase = await authorized();
      purchase.provider.fail('capture-before');
      await round(purchase.payment, purchase.attempt.id);
      await db.user.update({ where: { id: purchase.userId }, data: { isActive: false } });
      const attempt = await settle(db, purchase.payment, purchase.attempt.id);
      expect(attempt.state).toBe('PAID');
      const events = await eventsFor(attempt.orderId!);
      expect(events).toHaveLength(2);
      for (const event of events) {
        expect(event).toMatchObject({ dispatchState: 'SUPPRESSED', recipient: null, suppressionReason: 'ACCOUNT_INACTIVE' });
        expect(event.snapshot).toMatchObject({ suppressed: true, orderReference: `ORD-${attempt.orderId!.toUpperCase()}` });
      }
      const transport = new ScriptedTransport();
      await dispatcher(transport).runBatch();
      expect(transport.sent.filter(message => message.subject.includes(attempt.orderId!.toUpperCase()))).toHaveLength(0);
      expect(await sqlStateOf(db.commerceEmailOutbox.update({ where: { id: events[0]!.id }, data: { dispatchState: 'READY', suppressionReason: null } }))).toBe('REJECTED');
      expect(await sqlStateOf(db.commerceEmailOutbox.update({ where: { id: events[0]!.id }, data: { recipient: 'someone@example.com' } }))).toBe('REJECTED');
    });

    it('T06/T07: genuine cancellation without refund emits ORDER_CANCELLED that does not claim a refund, and no refund event', async () => {
      const purchase = await authorized();
      purchase.provider.fail('capture-rejected');
      const attempt = await settle(db, purchase.payment, purchase.attempt.id);
      expect(attempt.state).toBe('COMPENSATED');
      const events = await eventsFor(attempt.orderId!);
      expect(events.map(event => event.type)).toEqual(['ORDER_CANCELLED']);
      expect(events[0]).toMatchObject({ fromStatus: 'AWAITING_CAPTURE', toStatus: 'CANCELLED' });
      expect(events[0]!.snapshot).toMatchObject({ paymentConfirmed: false, refund: null });
      // A replayed compensation (another wake) creates nothing new.
      await purchase.payment.wake(purchase.attempt.id); await round(purchase.payment, purchase.attempt.id);
      expect(await eventsFor(attempt.orderId!)).toHaveLength(1);
    });

    it('verified refund recorded with the cancellation emits ORDER_CANCELLED (with refund) and PAYMENT_REFUNDED with the verified amount', async () => {
      const purchase = await authorized();
      purchase.provider.fail('capture-before');
      await round(purchase.payment, purchase.attempt.id);
      const intent = purchase.provider.intentFor(purchase.attempt.id);
      purchase.provider.intents.set(intent.id, { ...intent, status: 'succeeded', capturable: 0, received: intent.amount + 100 });
      const attempt = await settle(db, purchase.payment, purchase.attempt.id);
      expect(attempt.state).toBe('REFUNDED');
      const events = await eventsFor(attempt.orderId!);
      expect(events.map(event => event.type)).toEqual(['ORDER_CANCELLED', 'PAYMENT_REFUNDED']);
      const refund = events[1]!;
      expect(refund.eventKey).toBe(`payment:${refund.paymentId}:refund:${attempt.refundId}`);
      expect(refund.snapshot).toMatchObject({ amount: '13.34', currency: 'USD', refundId: attempt.refundId });
      expect(events[0]!.snapshot).toMatchObject({ refund: { amount: '13.34', currency: 'USD' } });
    });

    it('T08: a failed refund produces no refund confirmation and no cancellation email', async () => {
      const provider = new FailingRefundProvider();
      const purchase = await authorized(provider);
      provider.fail('capture-before');
      await round(purchase.payment, purchase.attempt.id);
      const intent = provider.intentFor(purchase.attempt.id);
      provider.intents.set(intent.id, { ...intent, status: 'succeeded', capturable: 0, received: intent.amount + 100 });
      await round(purchase.payment, purchase.attempt.id);
      const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
      expect(attempt.state).toBe('INCIDENT');
      expect(await eventsFor(attempt.orderId!)).toHaveLength(0);
    });

    it('T11/T12/DB09: fulfillment transition emits once; replay emits nothing; a later genuine transition to the same status gets a new identity', async () => {
      const { orderId } = await paid();
      const first = await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'PREPARING' }));
      const replay = await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'PREPARING' }));
      expect(first.changed).toBe(true); expect(replay).toEqual({ changed: false, event: null });
      await expect(db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'DELIVERED' }))).rejects.toMatchObject({ code: 'ORDER_TRANSITION_INVALID' });
      await db.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } }); // a future reviewed writer moving it back
      await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'PREPARING' }));
      await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'OUT_FOR_DELIVERY' }));
      await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'DELIVERED' }));
      const events = (await eventsFor(orderId)).filter(event => event.transitionId);
      expect(events.map(event => event.type).sort()).toEqual(['ORDER_DELIVERED', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_PREPARING', 'ORDER_PREPARING']);
      expect(new Set(events.map(event => event.eventKey)).size).toBe(4);
      for (const event of events) expect(commerceEmailSnapshot.safeParse(event.snapshot).success).toBe(true);
    });

    it('snapshots are immutable against later Product and account changes', async () => {
      const { orderId, productId, userId } = await paid();
      const before = await eventsFor(orderId);
      await db.product.update({ where: { id: productId }, data: { price: new Prisma.Decimal('99.99'), name: 'Renamed later' } });
      await db.user.update({ where: { id: userId }, data: { email: `changed-${randomUUID()}@example.invalid` } });
      expect((await eventsFor(orderId)).map(event => [event.recipient, event.snapshot])).toEqual(before.map(event => [event.recipient, event.snapshot]));
    });
  });

  describe('reads stay read-only; recovery stays live', () => {
    it('T23/E19: Order and Payment GET reads create no event and make no provider call; T24: another customer gets 404; T25: no fabricated projection', async () => {
      const { orderId, userId, attempt, payment, provider } = await paid();
      const orders = new OrderService(db);
      const count = await outboxCount(); const calls = { ...provider.callCounts };
      const details = await orders.getDetails(userId, `ORD-${orderId.toUpperCase()}`);
      await orders.getConfirmation(userId, `ORD-${orderId.toUpperCase()}`);
      await payment.status(userId, attempt.id); await payment.purchases(userId);
      expect(details.emailConfirmation).toMatchObject({ state: 'QUEUED' });
      const email = (await db.user.findUniqueOrThrow({ where: { id: userId } })).email;
      expect(JSON.stringify(details)).not.toContain(email);
      expect(JSON.stringify(details)).not.toMatch(/leaseToken|eventKey|dispatchState|providerMessageId|snapshot|attemptCount/);
      expect(Object.keys(details.emailConfirmation!).sort()).toEqual(['state', 'updatedAt']);
      expect(await outboxCount()).toBe(count);
      expect(provider.callCounts).toEqual(calls);
      const other = await makeCustomer(db);
      await expect(orders.getDetails(other, `ORD-${orderId.toUpperCase()}`)).rejects.toMatchObject({ statusCode: 404 });
      await db.commerceEmailOutbox.deleteMany({ where: { orderId } }); // historical order shape
      expect((await orders.getDetails(userId, `ORD-${orderId.toUpperCase()}`)).emailConfirmation).toBeUndefined();
    });

    it('E20: GET purchases no longer reconciles overdue work; the explicit POST recoverOverdue does, through the same lease', async () => {
      const purchase = await authorized();
      await db.paymentWork.update({ where: { attemptId: purchase.attempt.id }, data: { state: 'READY', nextRunAt: new Date(Date.now() - 120_000) } });
      const calls = purchase.provider.callCounts.retrieve;
      await purchase.payment.purchases(purchase.userId);
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(purchase.provider.callCounts.retrieve).toBe(calls);
      expect((await purchase.payment.recoverOverdue(purchase.userId)).scheduled).toBe(1);
      for (let wait = 0; wait < 100; wait++) {
        if ((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).state === 'PAID') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).state).toBe('PAID');
      expect(purchase.provider.captured).toBe(1);
      const other = await makeCustomer(db);
      expect((await purchase.payment.recoverOverdue(other)).scheduled).toBe(0);
    });
  });

  describe('dispatcher: leases, journal, uncertainty', () => {
    it('T13/DB04: two dispatchers on separate connections claim disjoint work; each event gets exactly one attempt', async () => {
      const { ids } = await readyEvents(8);
      const second = createDatabase(url, 'public');
      try {
        const a = new ScriptedTransport(); const b = new ScriptedTransport();
        // Limits cover every due row (earlier tests leave their own READY events), so the union must contain all of ours.
        const [left, right] = await Promise.all([dispatcher(a).claim(500), dispatcher(b, second).claim(500)]);
        const claimed = [...left, ...right].map(claim => claim.id).filter(id => ids.includes(id));
        expect(new Set(claimed).size).toBe(claimed.length);
        expect(claimed.sort()).toEqual([...ids].sort());
        const ours = (claims: typeof left) => claims.filter(claim => ids.includes(claim.id));
        await Promise.all([...ours(left).map(claim => dispatcher(a).process(claim)), ...ours(right).map(claim => dispatcher(b, second).process(claim))]);
        const attempts = await db.commerceEmailAttempt.groupBy({ by: ['outboxId'], where: { outboxId: { in: ids } }, _count: true });
        expect(attempts.every(row => row._count === 1)).toBe(true);
        expect(a.sent.length + b.sent.length).toBe(8);
      } finally { await second.$disconnect(); }
    });

    it('T18: provider acceptance is ACCEPTED/SENT, never DELIVERED; T22-backend: the order stays paid', async () => {
      const { ids, orderId } = await readyEvents(1);
      await dispatcher(new ScriptedTransport()).process((await dispatcher(new ScriptedTransport()).claim(10)).find(claim => claim.id === ids[0])!);
      const row = await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } });
      expect(row).toMatchObject({ dispatchState: 'ACCEPTED', deliveryState: 'UNKNOWN', attemptCount: 1, leaseToken: null });
      expect(row.providerMessageId).toBeTruthy(); expect(row.acceptedAt).toBeTruthy(); expect(row.deliveredAt).toBeNull();
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('CONFIRMED');
    });

    it('T14/DB05: an expired claim with no started attempt returns to READY without consuming budget', async () => {
      const { ids } = await readyEvents(1);
      const claims = await dispatcher(new ScriptedTransport()).claim(10);
      expect(claims.map(claim => claim.id)).toContain(ids[0]);
      await expireLease(ids[0]!);
      await dispatcher(new ScriptedTransport()).recoverExpired();
      expect(await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } })).toMatchObject({ dispatchState: 'READY', attemptCount: 0, leaseToken: null });
      expect(await db.commerceEmailAttempt.count({ where: { outboxId: ids[0] } })).toBe(0);
    });

    it('T15/T16/DB06: provider accepted but the acknowledgement was lost → UNCERTAIN after expiry, and never sent again', async () => {
      const { ids } = await readyEvents(1);
      let transactions = 0;
      // Claim is a single statement; start = 1st transaction; acknowledgement = 2nd transaction (fails after the provider accepted).
      const flaky = faultyDatabase(db, () => ++transactions === 2);
      const transport = new ScriptedTransport();
      const worker = dispatcher(transport, flaky);
      const claim = (await worker.claim(10)).find(item => item.id === ids[0])!;
      expect(await worker.process(claim)).toBe('UNCERTAIN');
      expect(transport.sent).toHaveLength(1);
      expect(await db.commerceEmailAttempt.findFirstOrThrow({ where: { outboxId: ids[0] } })).toMatchObject({ outcome: 'STARTED' });
      await expireLease(ids[0]!);
      await dispatcher(transport).runBatch();
      await dueNow(ids[0]!);
      await dispatcher(transport).runBatch();
      expect(await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } })).toMatchObject({ dispatchState: 'UNCERTAIN', attemptCount: 1 });
      expect(transport.sent).toHaveLength(1);
    });

    it('T17/DB07: a stale worker finishing after recovery cannot overwrite the newer state', async () => {
      const { ids } = await readyEvents(1);
      const gate = deferred(); const entered = deferred();
      const transport = new ScriptedTransport(async () => { entered.resolve(); await gate.promise; return { success: true, messageId: '<late@relay>' }; });
      const stale = dispatcher(transport);
      const claim = (await stale.claim(10)).find(item => item.id === ids[0])!;
      const inFlight = stale.process(claim);
      await entered.promise;
      await expireLease(ids[0]!);
      await dispatcher(new ScriptedTransport()).recoverExpired();
      expect(await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } })).toMatchObject({ dispatchState: 'UNCERTAIN' });
      gate.resolve();
      expect(await inFlight).toBe('STALE');
      const row = await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } });
      expect(row).toMatchObject({ dispatchState: 'UNCERTAIN', providerMessageId: null });
    });

    it('DB08: 429 schedules a bounded retry; five rejected attempts exhaust to FAILED with no tight loop', async () => {
      const { ids } = await readyEvents(1);
      const transport = new ScriptedTransport(() => ({ success: false, failure: { category: 'rejected', httpStatus: 429, retryAfterMs: 45_000 } }));
      for (let attempt = 1; attempt <= 5; attempt++) {
        await dueNow(ids[0]!);
        const before = Date.now();
        await dispatcher(transport).runBatch();
        const row = await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } });
        expect(row.attemptCount).toBe(attempt);
        if (attempt < 5) {
          expect(row.dispatchState).toBe('RETRY_WAIT');
          expect(row.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(44_000);
          await dispatcher(transport).runBatch(); // not due yet: nothing is sent
          expect(transport.sent).toHaveLength(attempt);
        } else expect(row).toMatchObject({ dispatchState: 'FAILED', lastErrorCode: 'RETRY_BUDGET_EXHAUSTED' });
      }
      expect(await db.commerceEmailAttempt.count({ where: { outboxId: ids[0] } })).toBe(5);
    });

    it('timeout and 5xx are UNCERTAIN (no retry); 401 pauses all sending; 400 is a permanent failure', async () => {
      const cases: [ProviderSendResult, string][] = [
        [{ success: false, failure: { category: 'timeout' } }, 'UNCERTAIN'],
        [{ success: false, failure: { category: 'rejected', httpStatus: 503 } }, 'UNCERTAIN'],
        [{ success: false, failure: { category: 'rejected', httpStatus: 400, providerCode: 'invalid_parameter' } }, 'FAILED'],
      ];
      for (const [result, expected] of cases) {
        const { ids } = await readyEvents(1);
        const worker = dispatcher(new ScriptedTransport(() => result));
        await worker.process((await worker.claim(10)).find(claim => claim.id === ids[0])!);
        expect((await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } })).dispatchState).toBe(expected);
      }
      const { ids } = await readyEvents(3);
      const transport = new ScriptedTransport(() => ({ success: false, failure: { category: 'rejected', httpStatus: 401 } }));
      const worker = dispatcher(transport);
      await worker.runBatch();
      expect(worker.paused).toBe(true);
      // The account problem stops the batch instead of burning every event: at most one in-flight send per concurrency lane.
      expect(transport.sent.length).toBeGreaterThanOrEqual(1);
      expect(transport.sent.length).toBeLessThanOrEqual(config.concurrency);
      const rows = await db.commerceEmailOutbox.findMany({ where: { id: { in: ids } } });
      expect(rows.filter(row => row.attemptCount === 0).every(row => row.dispatchState === 'READY')).toBe(true);
    });

    it('a deactivated account is suppressed at send time, before any provider call', async () => {
      const { ids, orderId } = await readyEvents(1);
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      await db.user.update({ where: { id: order.userId }, data: { isActive: false } });
      const transport = new ScriptedTransport();
      const worker = dispatcher(transport);
      await worker.process((await worker.claim(10)).find(claim => claim.id === ids[0])!);
      expect(await db.commerceEmailOutbox.findUniqueOrThrow({ where: { id: ids[0] } })).toMatchObject({ dispatchState: 'SUPPRESSED', suppressionReason: 'ACCOUNT_INACTIVE' });
      expect(transport.sent).toHaveLength(0);
    });

    it('rendered mail uses the snapshot, the trusted origin and the real reference', async () => {
      const { orderId } = await paid();
      const transport = new ScriptedTransport();
      const worker = dispatcher(transport);
      const ours = (await db.commerceEmailOutbox.findMany({ where: { orderId } })).map(row => row.id);
      for (const claim of (await worker.claim(50)).filter(item => ours.includes(item.id))) await worker.process(claim);
      const reference = `ORD-${orderId.toUpperCase()}`;
      const subjects = transport.sent.filter(message => message.subject.includes(reference)).map(message => message.subject).sort();
      expect(subjects).toEqual([`Order confirmed — ${reference}`, `Payment confirmed — ${reference}`]);
      for (const message of transport.sent.filter(item => item.subject.includes(reference))) {
        expect(message.html).toContain(`http://localhost:5173/orders/${reference}`);
        expect(message.text).toContain(`http://localhost:5173/orders/${reference}`);
      }
      const details = await new OrderService(db).getDetails((await db.order.findUniqueOrThrow({ where: { id: orderId } })).userId, reference);
      expect(details.emailConfirmation?.state).toBe('SENT');
    });
  });

  describe('DB10: physical schema, constraints, guards and exposure', () => {
    it('rejects every prohibited combination and accepts every allowed one', async () => {
      const { orderId } = await paid();
      const payment = await db.payment.findUniqueOrThrow({ where: { orderId } });
      const base = (over: Record<string, unknown> = {}) => db.commerceEmailOutbox.create({ data: { eventKey: `c:${randomUUID()}`, type: 'ORDER_CONFIRMED',
        orderId, recipient: 'a@example.com', templateVersion: 'v1', occurredAt: new Date(), snapshot: { v: 1 }, ...over } as Prisma.CommerceEmailOutboxUncheckedCreateInput });
      expect(await sqlStateOf(base({ recipient: null }))).toBe('REJECTED'); // dispatchable without recipient
      expect(await sqlStateOf(base({ recipient: '   ' }))).toBe('REJECTED');
      expect(await sqlStateOf(base({ snapshot: Prisma.DbNull }))).toBe('REJECTED');
      expect(await sqlStateOf(base({ snapshot: [1] }))).toBe('REJECTED'); // non-object snapshot
      expect(await sqlStateOf(base({ type: 'PAYMENT_CONFIRMED' }))).toBe('REJECTED'); // payment type without paymentId
      expect(await sqlStateOf(base({ type: 'ORDER_PREPARING' }))).toBe('REJECTED'); // transition without identity
      expect(await sqlStateOf(base({ type: 'ORDER_PREPARING', transitionId: randomUUID(), fromStatus: 'CONFIRMED', toStatus: 'CONFIRMED' }))).toBe('REJECTED');
      expect(await sqlStateOf(base({ type: 'ORDER_PREPARING', transitionId: randomUUID(), fromStatus: 'CONFIRMED', toStatus: 'DELIVERED' }))).toBe('REJECTED');
      expect(await sqlStateOf(base({ dispatchState: 'LEASED' }))).toBe('REJECTED'); // lease without token
      expect(await sqlStateOf(base({ dispatchState: 'ACCEPTED' }))).toBe('REJECTED'); // accepted without message id
      expect(await sqlStateOf(base({ deliveryState: 'DELIVERED' }))).toBe('REJECTED'); // delivered without acceptance/evidence
      expect(await sqlStateOf(base({ dispatchState: 'SUPPRESSED', recipient: null }))).toBe('REJECTED'); // suppressed without reason
      expect(await sqlStateOf(base({ attemptCount: -1 }))).toBe('REJECTED');
      expect(await sqlStateOf(base({ payloadPurgedAt: new Date(), recipient: null, snapshot: Prisma.DbNull }))).toBe('REJECTED'); // purged READY
      // Allowed shapes.
      expect(await sqlStateOf(base({ dispatchState: 'SUPPRESSED', recipient: null, suppressionReason: 'RECIPIENT_UNAVAILABLE' }))).toBe('NO_ERROR');
      expect(await sqlStateOf(base({ type: 'PAYMENT_CONFIRMED', paymentId: payment.id }))).toBe('NO_ERROR');
      const accepted = await base({ dispatchState: 'ACCEPTED', providerMessageId: `<${randomUUID()}>`, acceptedAt: new Date() });
      // Purge of a terminal row is allowed once; restoring or redispatching it is not.
      expect(await sqlStateOf(db.commerceEmailOutbox.update({ where: { id: accepted.id }, data: { payloadPurgedAt: new Date(), recipient: null, snapshot: Prisma.DbNull } }))).toBe('NO_ERROR');
      expect(await sqlStateOf(db.commerceEmailOutbox.update({ where: { id: accepted.id }, data: { payloadPurgedAt: null, recipient: 'a@example.com', snapshot: { v: 1 } } }))).toBe('REJECTED');
      expect(await sqlStateOf(db.commerceEmailOutbox.update({ where: { id: accepted.id }, data: { dispatchState: 'READY' } }))).toBe('REJECTED');
      const key = `c:${randomUUID()}`;
      await base({ eventKey: key });
      expect(await sqlStateOf(base({ eventKey: key }))).toBe('DUPLICATE');
      // Attempt journal.
      const ready = await base();
      expect(await sqlStateOf(db.commerceEmailAttempt.create({ data: { outboxId: ready.id, attemptNumber: 0, leaseToken: randomUUID(), startedAt: new Date() } }))).toBe('REJECTED');
      const attempt = await db.commerceEmailAttempt.create({ data: { outboxId: ready.id, attemptNumber: 1, leaseToken: randomUUID(), startedAt: new Date() } });
      expect(await sqlStateOf(db.commerceEmailAttempt.create({ data: { outboxId: ready.id, attemptNumber: 1, leaseToken: randomUUID(), startedAt: new Date() } }))).toBe('DUPLICATE');
      expect(await sqlStateOf(db.commerceEmailAttempt.update({ where: { id: attempt.id }, data: { outcome: 'ACCEPTED', finishedAt: new Date() } }))).toBe('REJECTED'); // no message id
      await db.commerceEmailAttempt.update({ where: { id: attempt.id }, data: { outcome: 'REJECTED', finishedAt: new Date(), errorCode: 'X' } });
      expect(await sqlStateOf(db.commerceEmailAttempt.update({ where: { id: attempt.id }, data: { outcome: 'ACCEPTED', providerMessageId: 'm' } }))).toBe('REJECTED');
    });

    it('RLS is enabled, browser roles have no privileges, and the due/lease indexes back the dispatcher queries', async () => {
      const rls = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>(Prisma.sql`SELECT relname::text AS relname, relrowsecurity FROM pg_class
        WHERE relname IN ('commerce_email_outbox', 'commerce_email_attempts') ORDER BY relname`);
      expect(rls.every(row => row.relrowsecurity)).toBe(true);
      const privileges = await db.$queryRaw<{ role: string; table: string; any: boolean }[]>(Prisma.sql`SELECT r.role, t.table,
        has_table_privilege(r.role, t.table, 'SELECT,INSERT,UPDATE,DELETE') AS "any"
        FROM (VALUES ('anon'), ('authenticated')) r(role), (VALUES ('commerce_email_outbox'), ('commerce_email_attempts')) t("table")`);
      expect(privileges.every(row => !row.any)).toBe(true);
      const indexes = await db.$queryRaw<{ indexname: string }[]>(Prisma.sql`SELECT indexname::text AS indexname FROM pg_indexes WHERE tablename = 'commerce_email_outbox'`);
      expect(indexes.map(row => row.indexname)).toEqual(expect.arrayContaining(['commerce_email_outbox_eventKey_key',
        'commerce_email_outbox_dispatchState_nextAttemptAt_createdAt_idx', 'commerce_email_outbox_dispatchState_leaseUntil_idx', 'commerce_email_outbox_orderId_createdAt_idx']));
      const plan = await db.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN SELECT "id" FROM "commerce_email_outbox"
        WHERE "dispatchState" IN ('READY', 'RETRY_WAIT') AND "nextAttemptAt" <= now() AT TIME ZONE 'UTC' ORDER BY "nextAttemptAt" LIMIT 10`);
      expect(plan.length).toBeGreaterThan(0);
    });
  });
});
