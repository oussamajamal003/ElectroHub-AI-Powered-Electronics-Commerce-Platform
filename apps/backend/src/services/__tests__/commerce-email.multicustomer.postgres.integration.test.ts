/**
 * Task 03.8 multi-customer delivery (DISPOSABLE PostgreSQL only; launched by scripts/commerce-email-pg.cjs, skipped everywhere else).
 * Regression for "the first test mailbox got its emails, a second customer did not": delivery must follow each account's own registered
 * address, with no per-address configuration in live mode, while the test allowlist keeps holding back everyone it does not list.
 * Real PaymentService/OrderService, scripted Stripe double, in-memory mail transport (no network, no Brevo).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentService } from '../payment.service.js';
import { CommerceEmailDispatcher, commerceEmailHealth, type CommerceEmailTransport, type OutgoingCommerceEmail } from '../commerce-email.dispatcher.js';
import { commerceEmailSnapshot } from '../commerce-email.domain.js';
import { orderReference } from '../commerce-email.domain.js';
import { renderCommerceEmail } from '../../emails/commerce/templates.js';
import { HarnessProvider, createContext, createDatabase, makeCustomer, makeProduct, settle, startPurchase, submitAndAuthorize } from './helpers/payment-postgres-harness.js';

const enabled = process.env.COMMERCE_EMAIL_PG_RUN === '1';
const db = enabled ? createDatabase(process.env.DATABASE_URL ?? '', 'public') : (null as unknown as PrismaClient);
const context = enabled ? createContext(db) : null!;
const base = { origin: 'http://localhost:5173', batchSize: 10, concurrency: 2, leaseMs: 60_000 };

class RecordingTransport implements CommerceEmailTransport {
  readonly name = 'BREVO' as const;
  readonly sent: OutgoingCommerceEmail[] = [];
  async send(message: OutgoingCommerceEmail) { this.sent.push(message); return { success: true, messageId: `<${randomUUID()}@smtp-relay.mailin.fr>` }; }
}
interface Customer { userId: string; email: string; orderId: string; paymentId: string }

/** A distinct active customer with their own registered address and one fully verified, settled purchase. */
async function customerWithPaidOrder(label: string): Promise<Customer> {
  const userId = await makeCustomer(db);
  const email = `customer-${label}-${randomUUID().replaceAll('-', '')}@customers.example.test`;
  await db.user.update({ where: { id: userId }, data: { email, isActive: true } });
  const provider = new HarnessProvider();
  const purchase = await startPurchase(context, userId, await makeProduct(db, 5), provider);
  await submitAndAuthorize(purchase, provider);
  const attempt = await settle(db, purchase.payment, purchase.attempt.id);
  expect(attempt.state).toBe('PAID');
  const payment = await db.payment.findUniqueOrThrow({ where: { orderId: attempt.orderId! } });
  expect(payment.status).toBe('SUCCEEDED');
  return { userId, email, orderId: attempt.orderId!, paymentId: payment.id };
}
const eventsOf = (customer: Customer) => db.commerceEmailOutbox.findMany({ where: { userId: customer.userId }, orderBy: { type: 'asc' } });
/** Runs bounded passes until this customer's events leave READY (other tests' leftovers may share the queue). */
async function drain(dispatcher: CommerceEmailDispatcher, customers: Customer[]) {
  for (let pass = 0; pass < 30; pass++) {
    await dispatcher.runBatch();
    const pending = await db.commerceEmailOutbox.count({ where: { userId: { in: customers.map(c => c.userId) }, dispatchState: { in: ['READY', 'LEASED', 'RETRY_WAIT'] } } });
    if (!pending) return;
  }
}

describe.skipIf(!enabled)('Task 03.8 multi-customer delivery — real PostgreSQL', () => {
  let a: Customer; let b: Customer;
  beforeAll(async () => { a = await customerWithPaidOrder('a'); b = await customerWithPaidOrder('b'); }, 120_000);
  afterAll(async () => { await db?.$disconnect(); });

  it('two distinct customers yield four unique events, each owned by and addressed to its own account', async () => {
    const [eventsA, eventsB] = [await eventsOf(a), await eventsOf(b)];
    expect(eventsA.map(event => event.type)).toEqual(['ORDER_CONFIRMED', 'PAYMENT_CONFIRMED']);
    expect(eventsB.map(event => event.type)).toEqual(['ORDER_CONFIRMED', 'PAYMENT_CONFIRMED']);
    expect(new Set([...eventsA, ...eventsB].map(event => event.eventKey)).size).toBe(4);
    for (const [customer, events] of [[a, eventsA], [b, eventsB]] as const) {
      for (const event of events) {
        expect(event).toMatchObject({ userId: customer.userId, orderId: customer.orderId, recipient: customer.email, dispatchState: 'READY' });
        expect(commerceEmailSnapshot.parse(event.snapshot).orderReference).toBe(orderReference(customer.orderId));
      }
      expect(events.find(event => event.type === 'PAYMENT_CONFIRMED')!.paymentId).toBe(customer.paymentId);
      expect(events.find(event => event.type === 'ORDER_CONFIRMED')!.paymentId).toBeNull();
    }
    expect(a.email).not.toBe(b.email);
    expect(JSON.stringify(eventsA.map(event => event.snapshot))).not.toContain(orderReference(b.orderId));
    expect(JSON.stringify(eventsB.map(event => event.snapshot))).not.toContain(orderReference(a.orderId));
  });

  it('allowlist mode (test environments): sends only to the listed customer; the other customer is held back, visibly, not lost', async () => {
    const transport = new RecordingTransport();
    const allowlisted = new CommerceEmailDispatcher(db, transport, renderCommerceEmail, { ...base, sendMode: 'allowlist', allowedRecipients: [a.email] });
    await drain(allowlisted, [a]);
    expect(transport.sent.filter(message => message.to === a.email)).toHaveLength(2);
    expect(transport.sent.some(message => message.to === b.email)).toBe(false);
    expect((await eventsOf(a)).map(event => event.dispatchState)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect((await eventsOf(b)).map(event => [event.dispatchState, event.attemptCount])).toEqual([['READY', 0], ['READY', 0]]);
    // The operator can tell "excluded by the test allowlist" from "worker dead": B's two due events are counted, nothing is expired or stuck.
    const health = await commerceEmailHealth(db, [a.email]);
    expect(health.allowlistExcluded).toBeGreaterThanOrEqual(2);
    expect(health.expiredLeases).toBe(0);
    expect((await commerceEmailHealth(db, [a.email, b.email])).allowlistExcluded).toBeLessThan(health.allowlistExcluded!);
    expect((await commerceEmailHealth(db)).allowlistExcluded).toBeNull(); // not meaningful outside allowlist mode
  }, 120_000);

  it('live mode: the second customer receives both emails at their own registered address, with no per-address configuration, and nothing is resent', async () => {
    const transport = new RecordingTransport();
    const live = new CommerceEmailDispatcher(db, transport, renderCommerceEmail, { ...base, sendMode: 'live', allowedRecipients: [] });
    await drain(live, [a, b]);
    const toB = transport.sent.filter(message => message.to === b.email);
    expect(toB.map(message => message.subject).sort()).toEqual([`Order confirmed — ${orderReference(b.orderId)}`, `Payment confirmed — ${orderReference(b.orderId)}`]);
    expect(toB.every(message => !message.html.includes(orderReference(a.orderId)) && !message.text.includes(orderReference(a.orderId)))).toBe(true);
    expect(transport.sent.some(message => message.to === a.email)).toBe(false); // A was already ACCEPTED: no duplicate
    expect((await eventsOf(b)).map(event => event.dispatchState)).toEqual(['ACCEPTED', 'ACCEPTED']);
    const attempts = await db.commerceEmailAttempt.findMany({ where: { outbox: { userId: { in: [a.userId, b.userId] } } } });
    expect(attempts).toHaveLength(4);
    expect(attempts.every(attempt => attempt.outcome === 'ACCEPTED' && attempt.attemptNumber === 1)).toBe(true);
    // Rerunning the worker is a no-op for already-accepted events.
    const again = new RecordingTransport();
    await new CommerceEmailDispatcher(db, again, renderCommerceEmail, { ...base, sendMode: 'live', allowedRecipients: [] }).runBatch();
    expect(again.sent.filter(message => [a.email, b.email].includes(message.to))).toHaveLength(0);
  }, 120_000);

  it('a declined payment, a pending checkout and an abandoned checkout create no success events', async () => {
    const userId = await makeCustomer(db);
    const provider = new HarnessProvider();
    const pending = await startPurchase(context, userId, await makeProduct(db, 5), provider); // checkout opened, nothing submitted
    expect(await db.commerceEmailOutbox.count({ where: { userId } })).toBe(0);
    await pending.payment.submit(userId, pending.attempt.id);
    const declined = provider.intentFor(pending.attempt.id);
    provider.intents.set(declined.id, { ...declined, declined: true });
    await pending.payment.process(pending.attempt.id);
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: pending.attempt.id } })).state).toBe('DECLINED');
    expect(await db.commerceEmailOutbox.count({ where: { userId } })).toBe(0);
    const orders = await db.order.count({ where: { userId } });
    expect(orders === 0 || (await db.order.count({ where: { userId, status: 'CONFIRMED' } })) === 0).toBe(true);
  }, 120_000);

  it('a repeated finalization of an already-settled purchase adds no events for either customer', async () => {
    const before = await db.commerceEmailOutbox.count({ where: { userId: { in: [a.userId, b.userId] } } });
    const service = new PaymentService(db, new HarnessProvider(), context.inventory);
    await Promise.all([a, b].map(customer => db.paymentAttempt.findFirst({ where: { userId: customer.userId, orderId: customer.orderId } })
      .then(attempt => attempt ? service.process(attempt.id).catch(() => null) : null)));
    expect(await db.commerceEmailOutbox.count({ where: { userId: { in: [a.userId, b.userId] } } })).toBe(before);
  }, 120_000);
});
