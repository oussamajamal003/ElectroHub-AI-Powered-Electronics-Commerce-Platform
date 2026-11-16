/**
 * PR #51 (Task 06.2) — two customers competing for the LAST unit, scenario Z (real PostgreSQL only; no Stripe, no network).
 *
 * Stock policy under test (unchanged): Add to Cart, Checkout setup and card entry reserve nothing; sellable stock is committed only by
 * OrderService.commitAuthorized after the provider authorized the card, under serializable isolation with the inventory row locked
 * FOR UPDATE. One test, four parts, each on its own product so the parts cannot interfere:
 *
 *   Z1  both customers authorized, commits race through a barrier: exactly one order, stock 1 -> 0, one capture; the loser's
 *       authorization is cancelled at the provider and verified by a fresh read; the loser's projection says "sold out" (never a card
 *       failure); restore returns the line to the Cart as OUT_OF_STOCK (once, reserving nothing; stock stays 0); replays by a fresh runner
 *       change nothing, and a second unit cannot be bought.
 *   Z2  the other customer bought the unit first: the loser's Place Order (submit) is refused with CART_STOCK_CONFLICT BEFORE any card
 *       confirmation; the attempt stays unsubmitted, the Cart line is kept (shown OUT_OF_STOCK) and can be removed.
 *   Z3  Buy Now follows the same gate: a Buy Now submit after the unit sold is refused with CART_STOCK_CONFLICT; nothing enters the Cart.
 *   Z4  Buy Now vs Cart checkout, both authorized, racing: one order, stock 0; a Buy Now loser is cancelled and never restorable to Cart.
 *   Z5  the unit sells AFTER the loser's submit but BEFORE card confirmation: confirmation-started is refused with CART_STOCK_CONFLICT,
 *       the card is never authorized, the unconfirmed intent is cancelled (fresh read), the purchase settles as sold out in that request,
 *       and it can be saved back to the Cart.
 *
 * Provider behaviour is the scripted HarnessProvider double: it is NOT Stripe evidence. Runs ONLY in disposable scope (scenarios-A-Z),
 * enabled by scripts/payment-pg-disposable.cjs; the target is re-proved here before any write.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../middleware/errorHandler.js';
import { buyNowProjection } from '../cart.service.js';
import { PaymentService } from '../payment.service.js';
import {
  Barrier, HarnessProvider, assertDisposableRun, assertRunSchemaIsolation, checkoutRequest, createContext, createDatabase,
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
const rejection = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { if (error instanceof AppError) return { code: error.code, status: error.statusCode, message: error.message }; throw error; }
  throw new Error('Expected a rejection.');
};

/** A Buy Now purchase set up through the real setup path (no Cart lines involved). */
async function startBuyNow(userId: string, productId: string, provider: HarnessProvider, quantity = 1) {
  const buyNow = { productId, quantity };
  const projection = await buyNowProjection(userId, buyNow, db);
  const payment = new PaymentService(db, provider, inventory);
  const setup = await payment.setup(userId, randomUUID(), { ...checkoutRequest(projection.data.revision), scope: 'BUY_NOW', buyNow });
  const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: setup.attemptId }, include: { items: true } });
  return { payment, setup, attempt, userId, productId };
}
/** Customer B buys the unit outright (Cart checkout to PAID). */
async function buyOutright(productId: string, provider: HarnessProvider) {
  const winner = await startPurchase(context, await makeCustomer(db), productId, provider, 1);
  await submitAndAuthorize(winner, provider);
  expect((await settle(db, winner.payment, winner.attempt.id)).state).toBe('PAID');
  return winner;
}

describe.skipIf(!disposableMode)('real PostgreSQL last-unit competition Z (disposable scope)', () => {
  beforeAll(async () => {
    run = await assertDisposableRun();
    await assertRunSchemaIsolation(db, run.schema);
  }, 60_000);
  afterAll(async () => { await db.$disconnect(); });

  it('Z — last unit: one winner, stock 1 -> 0, the loser is never captured, sees "sold out", and cannot buy a second unit (Cart and Buy Now)', async () => {
    // ---- Z1: both authorized, concurrent commit -----------------------------------------------------------------------------------
    {
      const productId = await makeProduct(db, 1); const provider = new HarnessProvider();
      const [a, b] = [await makeCustomer(db), await makeCustomer(db)];
      const purchases = [await startPurchase(context, a, productId, provider, 1), await startPurchase(context, b, productId, provider, 1)];
      expect(await stockOf(productId)).toBe(1); // Cart + Checkout setup reserve nothing
      expect(await shownAvailable(productId)).toBe(1);
      for (const purchase of purchases) await submitAndAuthorize(purchase, provider);
      expect(await stockOf(productId)).toBe(1); // authorization alone commits nothing

      const barrier = new Barrier(2);
      await Promise.allSettled(purchases.map(async purchase => { await barrier.wait(); return purchase.payment.process(purchase.attempt.id); }));
      const finals = [];
      for (const purchase of purchases) finals.push(await settle(db, purchase.payment, purchase.attempt.id));

      expect(finals.map(attempt => attempt.state).sort()).toEqual(['CANCELED', 'PAID']);
      const winner = purchases[finals.findIndex(attempt => attempt.state === 'PAID')]!;
      const loser = purchases[finals.findIndex(attempt => attempt.state === 'CANCELED')]!;
      const lost = finals.find(attempt => attempt.state === 'CANCELED')!;
      expect(lost.orderId).toBeNull();
      expect(lost.failureCode).toBe('CART_STOCK_CONFLICT');
      expect(lost.providerStatus).toBe('canceled');
      expect(await stockOf(productId)).toBe(0);
      expect(await shownAvailable(productId)).toBe(0);
      expect(await ordersFor(productId)).toBe(1);
      expect(provider.captured).toBe(1);
      expect(provider.intentFor(loser.attempt.id)).toMatchObject({ status: 'canceled', received: 0, capturable: 0 });
      expect(provider.intentFor(winner.attempt.id)).toMatchObject({ status: 'succeeded' });

      // Customer-visible truth for both customers.
      const loserView = await loser.payment.status(loser.userId, loser.attempt.id);
      expect(loserView).toMatchObject({ outcomeReason: 'STOCK_UNAVAILABLE', authorizationReleased: true, retryAllowed: false, committed: false,
        orderReference: null });
      expect(loserView.unavailableItems).toEqual([expect.objectContaining({ productId, quantity: 1, availableQuantity: 0, availability: 'OUT_OF_STOCK' })]);
      const winnerView = await winner.payment.status(winner.userId, winner.attempt.id);
      expect(winnerView).toMatchObject({ classification: 'SUCCEEDED', outcomeReason: null, committed: true });
      expect(winnerView.unavailableItems).toBeNull();
      const listed = (await loser.payment.purchases(loser.userId)).find(item => item.attemptId === loser.attempt.id);
      expect(listed).toMatchObject({ outcomeReason: 'STOCK_UNAVAILABLE', authorizationReleased: true, retryAllowed: false });

      // Saved-purchase recovery returns the line to the Cart even at 0 stock: shown OUT_OF_STOCK, checkout blocked, nothing reserved, once.
      await loser.payment.restore(loser.userId, loser.attempt.id);
      await loser.payment.restore(loser.userId, loser.attempt.id);
      const restored = await cart.get(loser.userId);
      expect(restored.canCheckout).toBe(false);
      expect(restored.items).toEqual([expect.objectContaining({ productId, quantity: 1, availability: 'OUT_OF_STOCK', availableQuantity: 0 })]);
      expect(await stockOf(productId)).toBe(0);
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: loser.attempt.id } })).restoredAt).not.toBeNull();

      // Replays by the same and by a fresh runner never create an order, capture, or restore stock.
      for (const purchase of purchases) {
        await db.paymentWork.updateMany({ where: { attemptId: purchase.attempt.id }, data: { state: 'READY', nextRunAt: new Date(0), leaseToken: null, leaseUntil: null } });
        await new PaymentService(db, provider, inventory).process(purchase.attempt.id);
        await settle(db, purchase.payment, purchase.attempt.id);
      }
      expect(await stockOf(productId)).toBe(0);
      expect(await ordersFor(productId)).toBe(1);
      expect(provider.captured).toBe(1);
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: loser.attempt.id } })).state).toBe('CANCELED');

      // The loser cannot obtain a second unit: adding it again is refused with the standard stock 409.
      expect(await rejection(cart.add(loser.userId, { productId, quantity: 1 }))).toMatchObject({ status: 409, code: 'CART_STOCK_CONFLICT' });
    }

    // ---- Z2: unit already sold, the loser's Place Order is refused before card confirmation --------------------------------------
    {
      const productId = await makeProduct(db, 1); const provider = new HarnessProvider();
      const loser = await startPurchase(context, await makeCustomer(db), productId, provider, 1);
      await buyOutright(productId, provider);
      expect(await stockOf(productId)).toBe(0);
      expect(await rejection(loser.payment.submit(loser.userId, loser.attempt.id))).toMatchObject({ status: 409, code: 'CART_STOCK_CONFLICT' });
      const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: loser.attempt.id } });
      expect(attempt.submittedAt).toBeNull();
      expect(attempt.orderId).toBeNull();
      expect(provider.intentFor(loser.attempt.id)).toMatchObject({ status: 'requires_payment_method', received: 0, capturable: 0 });
      const kept = await cart.get(loser.userId);
      expect(kept.canCheckout).toBe(false);
      expect(kept.items).toEqual([expect.objectContaining({ productId, quantity: 1, availability: 'OUT_OF_STOCK', availableQuantity: 0 })]);
      await cart.remove(loser.userId, productId); // the customer can correct the Cart
      expect((await cart.get(loser.userId)).items).toHaveLength(0);
      expect(await stockOf(productId)).toBe(0);
      expect(await ordersFor(productId)).toBe(1);
      expect(provider.captured).toBe(1);
    }

    // ---- Z3: Buy Now submit after the unit sold is refused the same way ----------------------------------------------------------
    {
      const productId = await makeProduct(db, 1); const provider = new HarnessProvider();
      const userId = await makeCustomer(db);
      const buyNow = await startBuyNow(userId, productId, provider);
      await buyOutright(productId, provider);
      expect(await rejection(buyNow.payment.submit(userId, buyNow.attempt.id))).toMatchObject({ status: 409, code: 'CART_STOCK_CONFLICT' });
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: buyNow.attempt.id } })).submittedAt).toBeNull();
      expect(provider.intentFor(buyNow.attempt.id)).toMatchObject({ status: 'requires_payment_method', received: 0, capturable: 0 });
      expect((await cart.get(userId)).items).toHaveLength(0); // Buy Now never touches the Cart
      expect(await stockOf(productId)).toBe(0);
      expect(await ordersFor(productId)).toBe(1);
    }

    // ---- Z4: Buy Now vs Cart checkout, both authorized, concurrent commit --------------------------------------------------------
    {
      const productId = await makeProduct(db, 1); const provider = new HarnessProvider();
      const buyNowUser = await makeCustomer(db);
      const purchases = [await startBuyNow(buyNowUser, productId, provider), await startPurchase(context, await makeCustomer(db), productId, provider, 1)];
      for (const purchase of purchases) await submitAndAuthorize(purchase, provider);
      const barrier = new Barrier(2);
      await Promise.allSettled(purchases.map(async purchase => { await barrier.wait(); return purchase.payment.process(purchase.attempt.id); }));
      const finals = [];
      for (const purchase of purchases) finals.push(await settle(db, purchase.payment, purchase.attempt.id));
      expect(finals.map(attempt => attempt.state).sort()).toEqual(['CANCELED', 'PAID']);
      expect(finals.find(attempt => attempt.state === 'CANCELED')).toMatchObject({ orderId: null, failureCode: 'CART_STOCK_CONFLICT', providerStatus: 'canceled' });
      expect(await stockOf(productId)).toBe(0);
      expect(await ordersFor(productId)).toBe(1);
      expect(provider.captured).toBe(1);
      expect((await cart.get(buyNowUser)).items).toHaveLength(0);
      if (finals[0]!.state === 'CANCELED') {
        expect(await rejection(purchases[0]!.payment.restore(buyNowUser, purchases[0]!.attempt.id))).toMatchObject({ code: 'PURCHASE_NOT_RESTORABLE' });
        expect((await cart.get(buyNowUser)).items).toHaveLength(0);
      }
    }

    // ---- Z5: sold between submit and card confirmation; the card is never authorized ---------------------------------------------
    {
      const productId = await makeProduct(db, 1); const provider = new HarnessProvider();
      const loser = await startPurchase(context, await makeCustomer(db), productId, provider, 1);
      await loser.payment.submit(loser.userId, loser.attempt.id); // passes: the unit is still there
      await buyOutright(productId, provider);
      expect(await stockOf(productId)).toBe(0);
      expect(await rejection(loser.payment.confirmationStarted(loser.userId, loser.attempt.id)))
        .toMatchObject({ status: 409, code: 'CART_STOCK_CONFLICT' });
      // Settled in that same request: the never-confirmed intent was cancelled and verified; nothing was authorized or captured.
      const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: loser.attempt.id } });
      expect(attempt).toMatchObject({ state: 'CANCELED', failureCode: 'CART_STOCK_CONFLICT', providerStatus: 'canceled', orderId: null, confirmationStartedAt: null });
      expect(provider.intentFor(loser.attempt.id)).toMatchObject({ status: 'canceled', received: 0, capturable: 0 });
      const view = await loser.payment.status(loser.userId, loser.attempt.id);
      expect(view).toMatchObject({ outcomeReason: 'STOCK_UNAVAILABLE', authorizationReleased: true, retryAllowed: false, committed: false });
      // A repeated signal (second tab) is refused too and changes nothing.
      expect(await rejection(loser.payment.confirmationStarted(loser.userId, loser.attempt.id))).toMatchObject({ status: 409 });
      await loser.payment.restore(loser.userId, loser.attempt.id);
      expect((await cart.get(loser.userId)).items).toEqual([expect.objectContaining({ productId, quantity: 1, availability: 'OUT_OF_STOCK' })]);
      expect(await stockOf(productId)).toBe(0);
      expect(await ordersFor(productId)).toBe(1);
      expect(provider.captured).toBe(1);
    }
  }, 180_000);
});
