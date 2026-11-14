import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { prisma } from '../../lib/prisma.js';
import { CustomerPushService } from '../customer-push.service.js';
import { CustomerPushDispatcher } from '../customer-push.dispatcher.js';
import { subscriptionSchema } from '../customer-push.config.js';
import { transitionFulfillment } from '../commerce-email.producer.js';
import { deliveryFixtures } from './helpers/delivery-fixtures.js';
import { AuthService } from '../auth.service.js';
import { AccountDeletionService } from '../account-deletion.service.js';
import pushRoutes from '../../routes/customer-push.routes.js';
import { generateAccessToken } from '../../utils/jwt.js';
import { errorHandler } from '../../middleware/errorHandler.js';
const enabled = process.env.DELIVERY_PG_RUN === '1';
const fixture = deliveryFixtures('push'); const service = new CustomerPushService();
const app = express(); app.use(express.json(), cookieParser(), pushRoutes, errorHandler);
const keys = () => { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }; };
const input = () => ({ endpoint: `https://fcm.googleapis.com/wp/${randomUUID()}`, keys: keys() });
async function session(label: string) {
  const user = await fixture.user('CUSTOMER', label); const familyId = randomUUID(); const raw = `customer.${randomUUID()}`;
  await prisma.refreshToken.create({ data: { userId: user.id, familyId, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now()+86400000) } });
  return { ...user, raw, familyId };
}
async function event(userId: string) {
  const order = await fixture.order(userId, 'PREPARING', 'SUCCEEDED');
  await prisma.$transaction(tx => transitionFulfillment(tx, { orderId: order.id, to: 'OUT_FOR_DELIVERY' }));
  return { order, notification: await prisma.customerNotification.findUniqueOrThrow({ where: { eventKey: `order:${order.id}:out-for-delivery` } }) };
}
describe.skipIf(!enabled).sequential('Web Push on disposable PostgreSQL', () => {
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL!); expect(['localhost','127.0.0.1']).toContain(url.hostname); expect(url.pathname).toMatch(/^\/electrohub_(disposable|ci)/);
    const vapid = createECDH('prime256v1'); vapid.generateKeys();
    vi.stubEnv('CUSTOMER_PUSH_ENABLED', 'true'); vi.stubEnv('WEB_PUSH_VAPID_PUBLIC_KEY', vapid.getPublicKey().toString('base64url'));
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', vapid.getPrivateKey().toString('base64url')); vi.stubEnv('WEB_PUSH_VAPID_SUBJECT', 'mailto:qa@example.invalid');
    vi.stubEnv('COMMERCE_EMAIL_ORIGIN', 'http://localhost:5173');
  });
  afterAll(async () => { vi.unstubAllEnvs(); await fixture.cleanup(); await prisma.$disconnect(); });
  it('requires customer authentication, the same live cookie session and trusted origin; prevents endpoint reassignment', async () => {
    const a = await session('api-a'); const b = await session('api-b'); const subscription = input();
    const token = generateAccessToken({ userId: a.id, role: 'CUSTOMER' });
    expect((await request(app).post('/auth/customer/push').set('Origin','http://localhost:5173').send(subscription)).status).toBe(401);
    expect((await request(app).post('/auth/customer/push').set('Authorization',`Bearer ${token}`).set('Origin','https://evil.invalid').send(subscription)).status).toBe(403);
    expect((await request(app).post('/auth/customer/push').set('Authorization',`Bearer ${token}`).set('Origin','http://localhost:5173').send(subscription)).status).toBe(401);
    const first = await service.register(a.id, a.raw, subscription); expect(await service.register(a.id, a.raw, subscription)).toEqual(first);
    const registered = await request(app).post('/auth/customer/push').set('Authorization', `Bearer ${token}`)
      .set('Cookie', `electrohub_customer_refresh=${a.raw}`).set('Origin', 'http://localhost:5173').send(subscription);
    expect(registered.status).toBe(201); expect(registered.body.data.id).toBe(first.id);
    const current = await request(app).get(`/auth/customer/push?id=${first.id}`).set('Authorization', `Bearer ${token}`)
      .set('Cookie', `electrohub_customer_refresh=${a.raw}`);
    expect(current.status).toBe(200); expect(current.body.data.enabled).toBe(true);
    expect(JSON.stringify(current.body)).not.toContain(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
    await expect(service.register(b.id, b.raw, subscription)).rejects.toMatchObject({ code: 'PUSH_RESET_REQUIRED' });
    await expect(service.revoke(b.id, b.raw, first.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(subscriptionSchema.safeParse({ ...subscription, endpoint: 'https://127.0.0.1/private' }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...subscription, endpoint: 'https://fcm.googleapis.com.evil.invalid/wp/x' }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ ...subscription, keys: { ...subscription.keys, auth: 'bad' } }).success).toBe(false);
  });
  it('commits one event per transition, isolates recipients and collapses duplicate worker calls', async () => {
    const a = await session('owner'); const b = await session('other');
    const sub = await service.register(a.id, a.raw, input()); await service.register(b.id, b.raw, input());
    const { order, notification } = await event(a.id);
    await prisma.$transaction(tx => transitionFulfillment(tx, { orderId: order.id, to: 'OUT_FOR_DELIVERY' }));
    const jobs = await prisma.customerPushDelivery.findMany({ where: { notificationId: notification.id } }); expect(jobs).toHaveLength(1);
    const send = vi.fn().mockResolvedValue({ statusCode: 201 }); const worker = new CustomerPushDispatcher(prisma, { send });
    await Promise.all([worker.runBatch(), worker.runBatch()]); await worker.process(jobs[0]!.id);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0]![1]); expect(payload).toEqual({ v: 1, bindingId: sub.id, eventId: notification.id });
    expect(await service.receipt(a.raw, sub.id, notification.id)).toEqual({ url: `/orders/${order.reference}` });
    await expect(service.receipt(b.raw, sub.id, notification.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await prisma.customerPushDelivery.findUniqueOrThrow({ where: { id: jobs[0]!.id } })).state).toBe('ACCEPTED');
  });
  it('rollback creates no push delivery; permission removal and logout block queued and in-flight receipts', async () => {
    const a = await session('revoke'); const sub = await service.register(a.id, a.raw, input());
    const order = await fixture.order(a.id,'PREPARING','SUCCEEDED');
    await expect(prisma.$transaction(async tx => { await transitionFulfillment(tx,{orderId:order.id,to:'OUT_FOR_DELIVERY'});throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await prisma.customerNotification.count({where:{orderId:order.id}})).toBe(0);
    const { notification } = await event(a.id);
    await new AuthService().logout(a.raw,'customer');
    const send=vi.fn(); await new CustomerPushDispatcher(prisma,{send}).runBatch(); expect(send).not.toHaveBeenCalled();
    await expect(service.receipt(a.raw,sub.id,notification.id)).rejects.toMatchObject({statusCode:401});
    expect((await prisma.customerPushSubscription.findUniqueOrThrow({where:{id:sub.id}})).revokedAt).not.toBeNull();
  });
  it('retries provider outages with bounded backoff; 410 retires subscription; deletion removes endpoint material', async () => {
    const a=await session('retry');const sub=await service.register(a.id,a.raw,input());const {notification}=await event(a.id);
    const send=vi.fn().mockRejectedValue({statusCode:503});const worker=new CustomerPushDispatcher(prisma,{send});await worker.runBatch();
    const job=await prisma.customerPushDelivery.findFirstOrThrow({where:{notificationId:notification.id}});expect(job.state).toBe('RETRY');expect(job.attempts).toBe(1);
    await worker.runBatch();expect(send).toHaveBeenCalledTimes(1);
    await prisma.customerPushDelivery.update({where:{id:job.id},data:{availableAt:new Date(0)}});send.mockRejectedValue({statusCode:410});await worker.runBatch();
    expect((await prisma.customerPushDelivery.findUniqueOrThrow({where:{id:job.id}})).state).toBe('EXPIRED');
    expect((await prisma.customerPushSubscription.findUniqueOrThrow({where:{id:sub.id}})).revokedAt).not.toBeNull();
    await new AccountDeletionService().deleteAccount(a.id);expect(await prisma.customerPushSubscription.count({where:{userId:a.id}})).toBe(0);
  });
  it('both push tables deny Data API access and retain RLS',async()=>{
    const rows=await prisma.$queryRaw<{rls:boolean}[]>`SELECT relrowsecurity AS rls FROM pg_class WHERE oid IN ('public.customer_push_subscriptions'::regclass,'public.customer_push_deliveries'::regclass)`;
    expect(rows).toHaveLength(2);expect(rows.every(row=>row.rls)).toBe(true);
    const grants=await prisma.$queryRaw<{exposed:boolean}[]>`SELECT has_table_privilege(rolname,'public.customer_push_subscriptions','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege(rolname,'public.customer_push_deliveries','SELECT,INSERT,UPDATE,DELETE') AS exposed FROM pg_roles WHERE rolname IN ('anon','authenticated')`;
    expect(grants.every(row=>!row.exposed)).toBe(true);
  });
  it('suppresses explicit consent removal, stale order events and exhausted crashed claims', async () => {
    const a = await session('disabled'); const sub = await service.register(a.id, a.raw, input());
    const disabled = await event(a.id); await service.revoke(a.id, a.raw, sub.id);
    const b = await session('stale'); await service.register(b.id, b.raw, input());
    const stale = await event(b.id);
    await prisma.customerNotification.update({ where: { id: stale.notification.id }, data: { occurredAt: new Date(Date.now() - 25 * 3600_000) } });
    const c = await session('exhausted'); await service.register(c.id, c.raw, input());
    const exhausted = await event(c.id);
    await prisma.customerPushDelivery.updateMany({ where: { notificationId: exhausted.notification.id }, data: { state: 'LEASED', attempts: 5, leaseUntil: new Date(0) } });
    const send = vi.fn(); await new CustomerPushDispatcher(prisma, { send }).runBatch();
    expect(send).not.toHaveBeenCalled();
    for (const [id, state] of [[disabled.notification.id, 'REVOKED'], [stale.notification.id, 'EXPIRED'], [exhausted.notification.id, 'FAILED']]) {
      expect((await prisma.customerPushDelivery.findFirstOrThrow({ where: { notificationId: id } })).state).toBe(state);
    }
    await expect(service.receipt(a.raw, sub.id, disabled.notification.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
