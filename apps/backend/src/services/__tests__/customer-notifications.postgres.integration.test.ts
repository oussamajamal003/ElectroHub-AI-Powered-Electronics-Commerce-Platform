import { AuthService } from '../auth.service.js';
import { emailService } from '../email.service.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import express from 'express';
import { createDatabase, makeCustomer, makeProduct, createContext, startPurchase, submitAndAuthorize, settle, HarnessProvider } from './helpers/payment-postgres-harness.js';
import { enqueueCustomerWelcome, transitionFulfillment } from '../commerce-email.producer.js';
import { CustomerNotificationService } from '../customer-notification.service.js';
import { CommerceEmailDispatcher } from '../commerce-email.dispatcher.js';
import { renderCommerceEmail } from '../../emails/commerce/templates.js';
import { otpService } from '../otp.service.js';
import { prisma } from '../../lib/prisma.js';
import { GoogleRepository } from '../../repositories/google.repository.js';
import { generateAccessToken } from '../../utils/jwt.js';
import notificationRoutes from '../../routes/customer-notification.routes.js';

const enabled = process.env.COMMERCE_EMAIL_PG_RUN === '1' || process.env.DELIVERY_PG_RUN === '1';
const db = enabled ? createDatabase(process.env.DATABASE_URL!, 'public') : null as unknown as PrismaClient;
const service = new CustomerNotificationService(db);
const app = express(); app.use(express.json(), notificationRoutes);
const events = (userId: string) => db.commerceEmailOutbox.findMany({ where: { userId, type: 'CUSTOMER_WELCOME' } });
async function verified() {
  const id = await makeCustomer(db);
  await db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  return id;
}
async function paidOrder() {
  const userId = await makeCustomer(db);
  const provider = new HarnessProvider();
  const purchase = await startPurchase(createContext(db), userId, await makeProduct(db, 3), provider);
  await submitAndAuthorize(purchase, provider);
  const attempt = await settle(db, purchase.payment, purchase.attempt.id);
  return { userId, orderId: attempt.orderId! };
}

describe.skipIf(!enabled).sequential('customer notifications: disposable PostgreSQL', () => {
  beforeAll(() => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(['127.0.0.1', 'localhost']).toContain(target.hostname);
    expect(target.pathname.startsWith('/electrohub_disposable_') ||
      (target.pathname === '/electrohub_ci' && process.env.ELECTROHUB_DISPOSABLE_DATABASE === '1')).toBe(true);
  });
  afterAll(async () => { vi.restoreAllMocks(); await db?.$disconnect(); await prisma.$disconnect(); });

  it('notification history has RLS and no Data API grants, including when default privileges grant tables', async () => {
    const rows = await db.$queryRaw<{ rls: boolean }[]>`SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.customer_notifications'::regclass`;
    expect(rows[0]!.rls).toBe(true);
    const roles = await db.$queryRaw<{ name: string; exposed: boolean }[]>`SELECT rolname::text AS name, has_table_privilege(rolname, 'public.customer_notifications', 'SELECT,INSERT,UPDATE,DELETE') AS exposed FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
    for (const role of roles) expect(role.exposed).toBe(false);
  });

  it('actual registration waits for verification and duplicate registration does not create another welcome', async () => {
    const capture = vi.spyOn(emailService, 'sendAccountVerificationOtp').mockResolvedValue(true);
    const auth = new AuthService(); const email = `register-${randomUUID()}@example.invalid`;
    const result = await auth.registerCustomer(email, 'Synthetic-password-123!', 'New', 'Customer');
    expect(result.requiresVerification).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await events(user.id)).toHaveLength(0);
    const code = capture.mock.calls[0]![1];
    const challenge = await db.otpChallenge.findFirstOrThrow({ where: { userId: user.id } });
    expect(await otpService.verifyEmailOtpWithOutcome(challenge.id, code)).toBe('VERIFIED');
    await expect(auth.registerCustomer(email, 'Synthetic-password-123!', 'New', 'Customer')).rejects.toThrow();
    expect(await events(user.id)).toHaveLength(1);
    await auth.login(email, 'Synthetic-password-123!');
    expect(await events(user.id)).toHaveLength(1);
    capture.mockRestore();
  });

  it('OTP verification commits one welcome, invalid/consumed codes and unverified customers create none', async () => {
    const id = await makeCustomer(db);
    await db.$transaction(tx => enqueueCustomerWelcome(tx, id, new Date()));
    expect(await events(id)).toHaveLength(0);
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    const challenge = await db.otpChallenge.create({ data: { userId: id, destination: user.email, purpose: 'EMAIL_VERIFICATION',
      channel: 'EMAIL', codeHash: otpService.hashCode('123456'), expiresAt: new Date(Date.now() + 60_000) } });
    expect(await otpService.verifyEmailOtpWithOutcome(challenge.id, '000000')).not.toBe('VERIFIED');
    expect(await events(id)).toHaveLength(0);
    expect(await otpService.verifyEmailOtpWithOutcome(challenge.id, '123456')).toBe('VERIFIED');
    expect(await otpService.verifyEmailOtpWithOutcome(challenge.id, '123456')).toBe('OTP_CONSUMED');
    const rows = await events(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: user.email, userId: id, orderId: null, dispatchState: 'READY' });
    await db.$transaction(tx => enqueueCustomerWelcome(tx, id, new Date()));
    expect(await events(id)).toHaveLength(1);
  });

  it('new Google customers receive welcome; linking/login does not call the new-account hook', async () => {
    const repository = new GoogleRepository();
    const user = await repository.createCustomer({ sub: randomUUID(), email: `google-${randomUUID()}@example.invalid`, firstName: 'Google', lastName: 'Fixture' });
    expect(await events(user.id)).toHaveLength(1);
    await repository.recordLogin(user.id);
    expect(await events(user.id)).toHaveLength(1);
  });

  it('rollback leaves no welcome; admin activation does not enqueue customer mail', async () => {
    const id = await verified();
    await expect(db.$transaction(async tx => { await enqueueCustomerWelcome(tx, id, new Date()); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await events(id)).toHaveLength(0);
    const role = await db.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN' }, update: {} });
    await db.user.update({ where: { id }, data: { roleId: role.id } });
    await db.$transaction(tx => enqueueCustomerWelcome(tx, id, new Date()));
    expect(await events(id)).toHaveLength(0);
  });

  it('welcome worker retries proven nonacceptance and suppresses duplicate execution', async () => {
    const id = await verified();
    await db.$transaction(tx => enqueueCustomerWelcome(tx, id, new Date()));
    const row = (await events(id))[0]!;
    const send = vi.fn().mockResolvedValueOnce({ success: false, failure: { category: 'connect' } })
      .mockResolvedValue({ success: true, messageId: `capture-${randomUUID()}` });
    const worker = new CommerceEmailDispatcher(db, { name: 'CAPTURE', send }, renderCommerceEmail,
      { sendMode: 'allowlist', allowedRecipients: [row.recipient!], origin: 'http://localhost:5173', batchSize: 100, concurrency: 1, leaseMs: 60000 });
    const claims = await worker.claim();
    for (const other of claims.filter(item => item.id !== row.id)) await worker.process(other);
    const claim = claims.find(item => item.id === row.id)!;
    expect(claim).toBeDefined();
    await worker.process(claim);
    expect((await events(id))[0]!.dispatchState).toBe('RETRY_WAIT');
    await db.commerceEmailOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    const retry = (await worker.claim()).find(item => item.id === row.id)!;
    await worker.process(retry); await worker.process(retry);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toMatchObject({ to: row.recipient, subject: 'Welcome to ElectroHub!' });
    expect((await events(id))[0]!.dispatchState).toBe('ACCEPTED');
  });

  it('only genuine out-for-delivery creates history; rollback/replay/concurrency are safe', async () => {
    const { userId, orderId } = await paidOrder();
    const transition = (to: 'PREPARING' | 'OUT_FOR_DELIVERY') => db.$transaction(tx => transitionFulfillment(tx, { orderId, to }));
    await transition('PREPARING');
    expect((await service.list(userId)).items).toHaveLength(0);
    await expect(db.$transaction(async tx => { await transitionFulfillment(tx, { orderId, to: 'OUT_FOR_DELIVERY' }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await service.list(userId)).items).toHaveLength(0);
    await Promise.all([transition('OUT_FOR_DELIVERY'), transition('OUT_FOR_DELIVERY')]);
    const list = await service.list(userId);
    expect(list.items).toHaveLength(1); expect(list.unreadCount).toBe(1);
    expect(await db.commerceEmailOutbox.count({ where: { orderId, type: 'ORDER_OUT_FOR_DELIVERY' } })).toBe(1);
    const other = await makeCustomer(db);
    expect((await service.list(other)).items).toHaveLength(0);
    await expect(service.markRead(other, list.items[0]!.id)).rejects.toMatchObject({ statusCode: 404 });
    await service.markRead(userId, list.items[0]!.id); await service.markRead(userId, list.items[0]!.id);
    expect((await new CustomerNotificationService(db).list(userId)).unreadCount).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('OUT_FOR_DELIVERY');
  });

  it('out-for-delivery provider outage leaves order/history intact and retry sends the correct template once', async () => {
    const { userId, orderId } = await paidOrder();
    await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'PREPARING' }));
    await db.$transaction(tx => transitionFulfillment(tx, { orderId, to: 'OUT_FOR_DELIVERY' }));
    const row = await db.commerceEmailOutbox.findFirstOrThrow({ where: { orderId, type: 'ORDER_OUT_FOR_DELIVERY' } });
    const send = vi.fn().mockResolvedValueOnce({ success: false, failure: { category: 'connect' } })
      .mockResolvedValue({ success: true, messageId: `capture-${randomUUID()}` });
    const worker = new CommerceEmailDispatcher(db, { name: 'CAPTURE', send }, renderCommerceEmail,
      { sendMode: 'allowlist', allowedRecipients: [row.recipient!], origin: 'http://localhost:5173', batchSize: 100, concurrency: 1, leaseMs: 60000 });
    const claim = (await worker.claim()).find(item => item.id === row.id)!;
    await worker.process(claim);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('OUT_FOR_DELIVERY');
    expect((await service.list(userId)).unreadCount).toBe(1);
    await db.commerceEmailOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    const retry = (await worker.claim()).find(item => item.id === row.id)!;
    await worker.process(retry); await worker.process(retry);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toMatchObject({ subject: 'Your ElectroHub Order Is Out for Delivery!', to: row.recipient });
    expect((await service.list(userId)).items).toHaveLength(1);
  });

  it('pagination retains notifications sharing one timestamp and counts unread across pages', async () => {
    const { userId, orderId } = await paidOrder();
    const occurredAt = new Date();
    await db.customerNotification.createMany({ data: Array.from({ length: 51 }, () => ({ id: randomUUID(), eventKey: randomUUID(),
      userId, orderId, occurredAt, type: 'ORDER_OUT_FOR_DELIVERY' })) });
    const first = await service.list(userId);
    expect(first.items).toHaveLength(50); expect(first.unreadCount).toBe(51);
    const [at, id] = first.nextBefore!.split('|');
    const second = await service.list(userId, { at: new Date(at!), id: id! });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(51);
  });

  it('notification API rejects unauthenticated and cross-customer queries', async () => {
    expect((await request(app).get('/notifications')).status).toBe(401);
    const id = await verified();
    const token = generateAccessToken({ userId: id, role: 'CUSTOMER' });
    expect((await request(app).get('/notifications?userId=other').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    const response = await request(app).get('/notifications').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200); expect(response.body.data.unreadCount).toBe(0);
  });
});
