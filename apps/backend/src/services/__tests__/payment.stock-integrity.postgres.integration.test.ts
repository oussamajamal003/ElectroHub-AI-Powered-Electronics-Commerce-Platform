/**
 * Task 06.2 payment and inventory integrity, scenarios T-Y (real PostgreSQL only; no Stripe, no network).
 *
 * Asserts the exact sellable-stock arithmetic of the direct-decrement model end to end, on the real schema and locks:
 *   T  Add to Cart reserves nothing                            (5 -> cart 5 -> stock 5; a second shopper may still add 5)
 *   U  a pre-authorization decline never decrements            (5 -> decline -> 5; no Order; card dismissible, stock untouched;
 *                                                               Remove failed payment cancels the still-open intent ONCE, verified by a
 *                                                               fresh read, then hides the card; an authorization seen first wins)
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

    // ---- Remove failed payment (discard): a declined purchase whose intent is still open is cancelled at the provider, then hidden ----
    {
      const discardProvider = new HarnessProvider(); const owner = await makeCustomer(db); const stranger = await makeCustomer(db);
      const failed = await startPurchase(context, owner, productId, discardProvider, 2);
      expect((await decline(failed, discardProvider)).state).toBe('DECLINED');
      expect((await failed.payment.purchases(owner)).find(item => item.attemptId === failed.attempt.id)).toMatchObject({ removal: 'CANCEL_AND_REMOVE', dismissible: true });
      const cartBefore = JSON.stringify((await cart.get(owner)).items);
      // Another customer cannot discard it (identical not-found), and nothing changes.
      await expect(failed.payment.discard(stranger, failed.attempt.id)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' });
      expect(discardProvider.callCounts.cancel).toBe(0);
      // Double-click / duplicate request: both answer, exactly one provider cancellation.
      const answers = await Promise.all([failed.payment.discard(owner, failed.attempt.id), new PaymentService(db, discardProvider, inventory).discard(owner, failed.attempt.id)]);
      for (let round = 0; round < 4 && !(await db.paymentAttempt.findUniqueOrThrow({ where: { id: failed.attempt.id } })).dismissedAt; round++) {
        await db.paymentWork.updateMany({ where: { attemptId: failed.attempt.id, state: 'READY' }, data: { nextRunAt: new Date(0) } });
        await failed.payment.process(failed.attempt.id);
      }
      expect(answers.every(answer => ['REMOVED', 'CANCEL_PENDING'].includes(answer.status))).toBe(true);
      const removed = await db.paymentAttempt.findUniqueOrThrow({ where: { id: failed.attempt.id } });
      expect(removed).toMatchObject({ state: 'CANCELED', providerStatus: 'canceled', failureCode: 'PAYMENT_DISCARDED_BY_CUSTOMER', orderId: null, refundId: null });
      expect(removed.dismissedAt).not.toBeNull();
      expect(discardProvider.intentFor(failed.attempt.id).status).toBe('canceled');
      expect(discardProvider.callCounts.cancel).toBe(1);
      expect(discardProvider.callCounts.refund).toBe(0);
      expect(discardProvider.captured).toBe(0);
      // Audit rows are kept; the card is gone from the active list and stays gone for a fresh service (reload / restart).
      expect(await db.paymentAttemptItem.count({ where: { attemptId: failed.attempt.id } })).toBeGreaterThan(0);
      expect((await new PaymentService(db, discardProvider, inventory).purchases(owner)).some(item => item.attemptId === failed.attempt.id)).toBe(false);
      // Replays (repeat request, worker retry by a fresh runner) change nothing and never cancel again.
      await expect(failed.payment.discard(owner, failed.attempt.id)).resolves.toMatchObject({ status: 'REMOVED' });
      await db.paymentWork.updateMany({ where: { attemptId: failed.attempt.id }, data: { state: 'READY', nextRunAt: new Date(0), leaseToken: null, leaseUntil: null } });
      await new PaymentService(db, discardProvider, inventory).process(failed.attempt.id);
      expect(discardProvider.callCounts.cancel).toBe(1);
      expect(await stockOf(productId)).toBe(5);
      expect(await ordersFor(productId)).toBe(0);
      // Removal never adds to, empties or otherwise changes the customer's Cart.
      expect(JSON.stringify((await cart.get(owner)).items)).toBe(cartBefore);
    }

    // ---- Provider truth wins: the card was authorized (another tab) before the discard request reaches the provider ----
    {
      const racedProvider = new HarnessProvider(); const owner = await makeCustomer(db);
      const raced = await startPurchase(context, owner, productId, racedProvider, 1);
      expect((await decline(raced, racedProvider)).state).toBe('DECLINED');
      racedProvider.setStatus(raced.attempt.id, 'requires_capture');
      await expect(raced.payment.discard(owner, raced.attempt.id)).rejects.toMatchObject({ code: 'PAYMENT_STATUS_UNCONFIRMED' });
      expect(racedProvider.callCounts.cancel).toBe(0);
      const paid = await settle(db, raced.payment, raced.attempt.id);
      expect(paid).toMatchObject({ state: 'PAID', dismissedAt: null });
      expect(racedProvider.captured).toBe(1);
      expect(await stockOf(productId)).toBe(4);
      // A paid purchase offers no removal and refuses one.
      expect((await raced.payment.purchases(owner)).find(item => item.attemptId === raced.attempt.id)).toMatchObject({ removal: null, dismissible: false });
      await expect(raced.payment.discard(owner, raced.attempt.id)).rejects.toMatchObject({ code: 'PAYMENT_STATUS_UNCONFIRMED' });
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: raced.attempt.id } })).dismissedAt).toBeNull();
    }

    // ---- The authorization lands AFTER the discard was recorded but before the worker cancels: it is honoured, never cancelled ----
    {
      const lateProvider = new HarnessProvider(); const owner = await makeCustomer(db);
      const late = await startPurchase(context, owner, productId, lateProvider, 1);
      expect((await decline(late, lateProvider)).state).toBe('DECLINED');
      await db.paymentAttempt.update({ where: { id: late.attempt.id }, data: { cancelRequested: true, failureCode: 'PAYMENT_DISCARDED_BY_CUSTOMER' } });
      expect((await late.payment.purchases(owner)).find(item => item.attemptId === late.attempt.id)).toMatchObject({ removal: 'PENDING' });
      lateProvider.setStatus(late.attempt.id, 'requires_capture');
      await db.paymentWork.updateMany({ where: { attemptId: late.attempt.id }, data: { state: 'READY', nextRunAt: new Date(0) } });
      const paid = await settle(db, late.payment, late.attempt.id);
      expect(paid).toMatchObject({ state: 'PAID', dismissedAt: null, cancelRequested: false });
      expect(lateProvider.callCounts.cancel).toBe(0);
      expect(lateProvider.captured).toBe(1);
      expect(await stockOf(productId)).toBe(3);
    }
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
    // Compensation pending: the purchase is not a removable failure yet, and a removal request is refused without hiding anything.
    expect((await purchase.payment.purchases(userId)).find(item => item.attemptId === purchase.attempt.id)?.removal ?? null).toBeNull();
    await expect(purchase.payment.discard(userId, purchase.attempt.id)).rejects.toMatchObject({ code: 'PAYMENT_STATUS_UNCONFIRMED' });
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: purchase.attempt.id } })).dismissedAt).toBeNull();
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
    expect(listed).toMatchObject({ classification: 'FAILED', retryAllowed: false, dismissible: true, removal: 'REMOVE' });
    // Remove failed payment on an already-terminal, compensated failure hides it without touching the provider, the Order or stock.
    const providerCalls = { ...provider.callCounts };
    await expect(purchase.payment.discard(userId, purchase.attempt.id)).resolves.toMatchObject({ status: 'REMOVED' });
    expect({ cancel: provider.callCounts.cancel, refund: provider.callCounts.refund, capture: provider.callCounts.capture, retrieve: provider.callCounts.retrieve })
      .toEqual({ cancel: providerCalls.cancel, refund: providerCalls.refund, capture: providerCalls.capture, retrieve: providerCalls.retrieve });
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
