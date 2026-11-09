import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { storeSettings } from './store-settings.service.js';
import { CheckoutService } from './checkout.service.js';
import { PaymentService } from './payment.service.js';
import { invalidateShippingConfig } from './shipping-config.js';
import { checkoutRequest, createContext, HarnessProvider, makeCustomer, makeProduct, settle } from './__tests__/helpers/payment-postgres-harness.js';

describe.skipIf(process.env.ADMIN_SECURITY_PG_RUN !== '1').sequential('independent free shipping on disposable PostgreSQL', () => {
  const actor = randomUUID();
  const checkout = new CheckoutService();
  const context = createContext(prisma);
  let original: Awaited<ReturnType<typeof storeSettings.getShipping>>;
  const completed: { orderId: string; attemptId: string; order: string; payment: string }[] = [];
  async function configure(free: boolean, standard: boolean) {
    const current = await storeSettings.getShipping();
    return storeSettings.updateShipping(actor, { expectedVersion: current.version, freeShippingThreshold: free ? '50.00' : null,
      methods: [{ method: 'STANDARD', enabled: standard, price: '5.00' },
        { method: 'EXPRESS', enabled: true, price: '9.99' }, { method: 'OVERNIGHT', enabled: false, price: '19.99' }] });
  }
  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('Disposable loopback only.');
    original = await storeSettings.getShipping();
  });
  afterAll(async () => {
    if (original) await storeSettings.updateShipping(actor, { expectedVersion: (await storeSettings.getShipping()).version,
      freeShippingThreshold: original.freeShippingThreshold, methods: original.methods.map(({ method, enabled, price }) => ({ method, enabled, price })) });
    invalidateShippingConfig();
    await prisma.$disconnect();
  });
  it.each([
    [true, false, '49.99', null], [true, false, '50.00', '0.00'], [true, false, '50.01', '0.00'],
    [true, false, '60.00', '0.00'], [true, true, '40.00', '5.00'], [true, true, '60.00', '0.00'],
    [false, true, '60.00', '5.00'], [false, false, '60.00', null],
  ])('saved config free=%s standard=%s subtotal=%s quote=%s', async (free, standard, subtotal, price) => {
    await storeSettings.previewShipping(subtotal); // Warm the old cache before saving.
    await configure(free, standard);
    const preview = await storeSettings.previewShipping(subtotal);
    expect(preview.methods.find(row => row.id === 'STANDARD')?.price ?? null).toBe(price);
    const userId = await makeCustomer(prisma); const productId = await makeProduct(prisma, 10);
    await prisma.product.update({ where: { id: productId }, data: { price: subtotal } });
    await context.cart.add(userId, { productId, quantity: 1 });
    // Buy Now first: the later CART_CHECKOUT capture may consume the cart line.
    for (const scope of ['BUY_NOW', 'CART_CHECKOUT'] as const) {
      const buyNow = scope === 'BUY_NOW' ? { productId, quantity: 1 } : undefined;
      const quote = await checkout.get(userId, buyNow);
      expect(quote.deliveryMethods.map(({ totals: _totals, ...row }) => row)).toEqual(preview.methods);
      const provider = new HarnessProvider(); const payment = new PaymentService(prisma, provider, context.inventory);
      const request = { ...checkoutRequest(quote.cartRevision), ...(buyNow ? { scope, buyNow } : {}) };
      if (price === null) {
        await expect(payment.setup(userId, randomUUID(), request)).rejects.toMatchObject({ code: 'CHECKOUT_INVALID_DELIVERY' });
        expect(provider.callCounts.create).toBe(0);
      } else {
        const setup = await payment.setup(userId, randomUUID(), request);
        const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: setup.attemptId } });
        expect(attempt.shippingCost.toFixed(2)).toBe(price);
        expect(attempt.total.toFixed(2)).toBe(quote.deliveryMethods.find(row => row.id === 'STANDARD')!.totals.total);
        expect((await provider.retrieve(attempt.providerIntentId!)).amount).toBe(attempt.amountCents);
        expect(attempt.amountCents).toBe(attempt.total.mul(100).toNumber());
        if (free && !standard && subtotal === '60.00') {
          await payment.submit(userId, attempt.id);
          provider.setStatus(attempt.id, 'requires_capture');
          const final = await settle(prisma, payment, attempt.id);
          expect(final.state).toBe('PAID');
          const order = await prisma.order.findUniqueOrThrow({ where: { id: final.orderId! } });
          const paid = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
          expect([order.shippingCost.toFixed(2), order.total.toFixed(2), paid.amount.toFixed(2)]).toEqual(['0.00', '60.00', '60.00']);
          completed.push({ orderId: order.id, attemptId: attempt.id, order: JSON.stringify(order), payment: JSON.stringify(paid) });
        }
      }
    }
  });
  it('configuration changes reject stale setup, saved retry and final commit while completed purchases remain unchanged', async () => {
    await configure(true, false);
    const userId = await makeCustomer(prisma); const productId = await makeProduct(prisma, 10);
    await prisma.product.update({ where: { id: productId }, data: { price: '60.00' } });
    await context.cart.add(userId, { productId, quantity: 1 });
    const quote = await checkout.get(userId); const provider = new HarnessProvider();
    const payment = new PaymentService(prisma, provider, context.inventory);
    const request = checkoutRequest(quote.cartRevision);
    const setup = await payment.setup(userId, randomUUID(), request);
    await payment.submit(userId, setup.attemptId);
    const intent = provider.intentFor(setup.attemptId);
    provider.intents.set(intent.id, { ...intent, status: 'requires_payment_method', declined: true });
    // Submit transferred the original line into the saved purchase. Give fresh setup a valid active cart too.
    await context.cart.add(userId, { productId, quantity: 1 });
    await configure(false, false);
    await expect(payment.setup(userId, randomUUID(), request)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    await expect(payment.resume(userId, setup.attemptId)).rejects.toMatchObject({ code: 'CHECKOUT_CHANGED' });
    provider.setStatus(setup.attemptId, 'requires_capture');
    const final = await settle(prisma, payment, setup.attemptId);
    expect(final.state).toBe('CANCELED');
    expect(final.orderId).toBeNull(); expect(provider.captured).toBe(0);
    expect(completed).toHaveLength(2);
    for (const saved of completed) {
      expect(JSON.stringify(await prisma.order.findUniqueOrThrow({ where: { id: saved.orderId } }))).toBe(saved.order);
      expect(JSON.stringify(await prisma.payment.findUniqueOrThrow({ where: { orderId: saved.orderId } }))).toBe(saved.payment);
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: saved.attemptId } })).state).toBe('PAID');
    }
  });
});
