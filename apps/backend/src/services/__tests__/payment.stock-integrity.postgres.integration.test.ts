/**
 * Task 06.2 payment and inventory integrity, scenarios T-Y (real PostgreSQL only; no Stripe, no network).
 *
 * Asserts the exact sellable-stock arithmetic of the direct-decrement model end to end, on the real schema and locks:
 *   T  Add to Cart reserves nothing                            (5 -> cart 5 -> stock 5; a second shopper may still add 5)
 *   U  a pre-authorization decline never decrements            (5 -> decline -> 5; no Order; card dismissible, stock untouched)
 *   V  an authorized purchase of 2 decrements exactly once     (5 -> authorize 2 -> 3; repeated worker passes stay 3)
 *   W  a failed (capture-rejected) order is compensated once   (5 -> 3 -> compensate -> 5; repeated compensation stays 5;
 *                                                               the compensated card is dismissible and dismissal changes nothing else)
 *   X  two shoppers buying 4 each from stock 5 never oversell  (exactly one commits; stock 1; never negative)
 *   Y  decline then a later authorization of the same intent   (5 -> decline -> 5 -> authorize -> 3; replays stay 3)
 *
 * Customer-visible availability is read through InventoryService.getSnapshot, the projection the catalog and Cart use.
 * Provider behaviour is the scripted HarnessProvider double; it is not Stripe evidence. Runs ONLY in disposable scope, enabled
 * by scripts/payment-pg-disposable.cjs; the target is re-proved here before any write.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentService } from '../payment.service.js';
import {
  Barrier, HarnessProvider, assertDisposableRun, assertRunSchemaIsolation, createContext, createDatabase,
  disposableMode, makeCustomer, makeProduct, settle, startPurchase, submitAndAuthorize, type DisposableRun,
} from './helpers/payment-postgres-harness.js';

const connectionString = process.env.PAYMENT_PG_TEST_DATABASE_URL ?? '';
const schema = process.env.PAYMENT_PG_DISPOSABLE_SCHEMA ?? '';
const db = createDatabase(connectionString, schema);
const context = createContext(db);
const { cart, inventory } = context;
let run: DisposableRun;

const stockOf = async (productId: string) => (await db.inventory.findUniqueOrThrow({ where: { productId } })).quantity;
const shownAvailable = async (productId: string) => (await inventory.getSnapshot(productId, db)).availableQuantity;
const ordersFor = (productId: string) => db.order.count({ where: { items: { some: { productId } } } });
/** Declines the submitted purchase at the provider (no authorization) and lets the durable worker record it. */
async function decline(purchase: Awaited<ReturnType<typeof startPurchase>>, provider: HarnessProvider) {
  await purchase.payment.submit(purchase.userId, purchase.attempt.id);
  const intent = provider.intentFor(purchase.attempt.id);
  provider.intents.set(intent.id, { ...intent, status: 'requires_payment_method', declined: true });
  await purchase.payment.process(purchase.attempt.id);
  return db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
}
/** The DONE decline row is re-checked by the runner (a later confirmation must not be stranded); make it due now. */
async function recheck(payment: PaymentService, attemptId: string) {
  await db.paymentWork.update({ where: { attemptId }, data: { nextRunAt: new Date(0) } });
  await payment.runBatch([attemptId]);
}

describe.skipIf(!disposableMode)('real PostgreSQL payment and inventory integrity T-Y (disposable scope)', () => {
  beforeAll(async () => {
    run = await assertDisposableRun();
    await assertRunSchemaIsolation(db, run.schema);
  }, 60_000);
  afterAll(async () => { await db.$disconnect(); });

  it('T — Add to Cart reserves nothing: stock stays 5 and a second shopper may still add all 5', async () => {
    const productId = await makeProduct(db, 5);
    const [first, second] = [await makeCustomer(db), await makeCustomer(db)];
    await cart.add(first, { productId, quantity: 5 });
    expect(await stockOf(productId)).toBe(5);
    expect(await shownAvailable(productId)).toBe(5);
    await cart.add(second, { productId, quantity: 5 });
    expect((await cart.get(second)).items.find(item => item.productId === productId)?.quantity).toBe(5);
    expect(await stockOf(productId)).toBe(5);
    expect(await ordersFor(productId)).toBe(0);
  });

  it('U — a pre-authorization decline never decrements: 5 stays 5, no Order, and removing the card changes only dismissedAt', async () => {
    const productId = await makeProduct(db, 5); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider, 2);
    const declined = await decline(purchase, provider);
    expect(declined.state).toBe('DECLINED');
    expect(declined.orderId).toBeNull();
    expect(await stockOf(productId)).toBe(5);
    expect(await shownAvailable(productId)).toBe(5);
    expect(await ordersFor(productId)).toBe(0);

    const listed = (await purchase.payment.purchases(userId)).find(item => item.attemptId === purchase.attempt.id);
    expect(listed).toMatchObject({ classification: 'DECLINED', retryAllowed: true, cancelable: false, dismissible: true });
    const before = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
    await purchase.payment.dismiss(userId, purchase.attempt.id);
    const after = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
    expect(after.dismissedAt).not.toBeNull();
    expect({ ...after, dismissedAt: null, updatedAt: null }).toEqual({ ...before, dismissedAt: null, updatedAt: null });
    expect(await stockOf(productId)).toBe(5);
    expect((await purchase.payment.purchases(userId)).some(item => item.attemptId === purchase.attempt.id)).toBe(false);
  });

  it('V — an authorized purchase of 2 decrements exactly once: 5 becomes 3 and repeated worker passes keep 3', async () => {
    const productId = await makeProduct(db, 5); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider, 2);
    expect(await stockOf(productId)).toBe(5); // checkout setup reserves nothing either
    await submitAndAuthorize(purchase, provider);
    const paid = await settle(db, purchase.payment, purchase.attempt.id);
    expect(paid.state).toBe('PAID');
    expect(await stockOf(productId)).toBe(3);
    expect(await shownAvailable(productId)).toBe(3);
    for (const runner of [purchase.payment, new PaymentService(db, provider, inventory)]) await settle(db, runner, purchase.attempt.id);
    expect(await stockOf(productId)).toBe(3);
    expect(await ordersFor(productId)).toBe(1);
    expect(provider.captured).toBe(1);
  });

  it('W — a failed order is compensated exactly once: 5 -> 3 -> 5, repeats stay 5, and the compensated card is dismissible', async () => {
    const productId = await makeProduct(db, 5); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider, 2);
    await submitAndAuthorize(purchase, provider);
    provider.fail('capture-rejected');
    const stall = provider.stallRetrieveAfterNextCancel();
    const first = purchase.payment.process(purchase.attempt.id);
    await stall.entered;
    expect(await stockOf(productId)).toBe(3); // committed at authorization; compensation has not run yet
    stall.release(); await first;
    const compensated = await settle(db, purchase.payment, purchase.attempt.id);
    expect(compensated.state).toBe('COMPENSATED');
    expect(compensated.compensatedAt).not.toBeNull();
    expect(await stockOf(productId)).toBe(5);
    expect(await shownAvailable(productId)).toBe(5);

    // Replays by the same and by a fresh runner never restore twice.
    await db.paymentWork.updateMany({ where: { attemptId: purchase.attempt.id }, data: { state: 'READY', nextRunAt: new Date(0), leaseToken: null, leaseUntil: null } });
    await new PaymentService(db, provider, inventory).process(purchase.attempt.id);
    await purchase.payment.process(purchase.attempt.id);
    expect(await stockOf(productId)).toBe(5);
    const order = await db.order.findUniqueOrThrow({ where: { id: compensated.orderId! } });
    expect(order.status).toBe('CANCELLED');
    expect(provider.captured).toBe(0);

    const settled = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
    const listed = (await purchase.payment.purchases(userId)).find(item => item.attemptId === purchase.attempt.id);
    expect(listed).toMatchObject({ classification: 'FAILED', retryAllowed: false, dismissible: true });
    await purchase.payment.dismiss(userId, purchase.attempt.id);
    const after = await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } });
    expect({ ...after, dismissedAt: null, updatedAt: null }).toEqual({ ...settled, dismissedAt: null, updatedAt: null });
    expect(after.dismissedAt).not.toBeNull();
    expect(await stockOf(productId)).toBe(5);
    expect((await db.order.findUniqueOrThrow({ where: { id: compensated.orderId! } })).status).toBe('CANCELLED');
    expect((await purchase.payment.purchases(userId)).some(item => item.attemptId === purchase.attempt.id)).toBe(false);
  });

  it('X — two shoppers buying 4 each from stock 5 never oversell: one commits, stock 1, never negative', async () => {
    const productId = await makeProduct(db, 5); const provider = new HarnessProvider();
    const purchases = [];
    for (const userId of [await makeCustomer(db), await makeCustomer(db)]) purchases.push(await startPurchase(context, userId, productId, provider, 4));
    expect(await stockOf(productId)).toBe(5);
    for (const purchase of purchases) await submitAndAuthorize(purchase, provider);
    const barrier = new Barrier(2);
    await Promise.allSettled(purchases.map(async purchase => { await barrier.wait(); return purchase.payment.process(purchase.attempt.id); }));
    const finals = [];
    for (const purchase of purchases) finals.push(await settle(db, purchase.payment, purchase.attempt.id));

    expect(finals.map(attempt => attempt.state).sort()).toEqual(['CANCELED', 'PAID']);
    expect(await stockOf(productId)).toBe(1);
    expect(await shownAvailable(productId)).toBe(1);
    expect(await ordersFor(productId)).toBe(1);
    expect(provider.captured).toBe(1);
    expect(finals.find(attempt => attempt.state === 'CANCELED')!.orderId).toBeNull();
  });

  it('Y — a decline followed by a later authorization of the same intent decrements exactly once: 5 -> 5 -> 3, replays stay 3', async () => {
    const productId = await makeProduct(db, 5); const userId = await makeCustomer(db); const provider = new HarnessProvider();
    const purchase = await startPurchase(context, userId, productId, provider, 2);
    expect((await decline(purchase, provider)).state).toBe('DECLINED');
    expect(await stockOf(productId)).toBe(5);
    // Try Again confirms the same intent client-side; the runner finds the authorization even without a webhook.
    provider.setStatus(purchase.attempt.id, 'requires_capture');
    await recheck(purchase.payment, purchase.attempt.id);
    expect((await settle(db, purchase.payment, purchase.attempt.id)).state).toBe('PAID');
    expect(await stockOf(productId)).toBe(3);
    await purchase.payment.runBatch([purchase.attempt.id]);
    await settle(db, new PaymentService(db, provider, inventory), purchase.attempt.id);
    expect(await stockOf(productId)).toBe(3);
    expect(await ordersFor(productId)).toBe(1);
    expect(provider.captured).toBe(1);
  });
});
