import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/jwt.js';
import { hashPassword } from '../src/utils/hash.js';
import { googleProvider } from '../src/providers/google.provider.js';
import { vi } from 'vitest';

const marker = crypto.randomUUID();
const originalEmail = `account-delete-${marker}@electrohub-test.invalid`;
const password = 'DeleteTest@12345';
const passwordHashPromise = hashPassword(password);
const startedAt = new Date();
let userId = '';
let productId = '';
let categoryId = '';
let accessToken = '';
let refreshToken = '';

beforeAll(async () => {
  env.GOOGLE_CLIENT_ID = 'account-deletion-test-client';
  env.GOOGLE_CLIENT_SECRET = 'account-deletion-test-secret';
  env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
  env.FRONTEND_URL = 'http://localhost:3000';
  env.JWT_SECRET = 'account-deletion-test-cookie-secret';
  await prisma.$connect();
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: {
      email: originalEmail,
      passwordHash: await passwordHashPromise,
      firstName: 'Disposable',
      lastName: 'Customer',
      emailVerifiedAt: new Date(),
      roleId: role.id,
      oauthAccounts: { create: { provider: 'GOOGLE', providerAccountId: `delete-${marker}`, providerEmail: originalEmail } },
      addresses: { create: { recipient: 'Disposable Customer', line1: '123 Test Street', city: 'Test City', country: 'Test Country' } },
      securityEvents: { create: { type: 'LOGIN_SUCCESS' } },
    },
  });
  userId = user.id;
  accessToken = generateAccessToken({ userId, role: 'CUSTOMER' });
  refreshToken = `refresh-${marker}`;
  await prisma.refreshToken.create({ data: { userId, tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: crypto.createHash('sha256').update(marker).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
  await prisma.otpChallenge.create({ data: { userId, purpose: 'PASSWORD_RESET', destination: originalEmail, codeHash: 'hashed-test-code', expiresAt: new Date(Date.now() + 60_000) } });
  await prisma.emailDelivery.create({ data: { userId, type: 'SECURITY_ALERT', recipient: originalEmail, failureReason: 'private provider diagnostic' } });
  const category = await prisma.category.create({ data: { name: `Delete ${marker.slice(0, 8)}`, slug: `delete-${marker}`, description: 'Disposable account deletion test category' } });
  categoryId = category.id;
  const product = await prisma.product.create({ data: { categoryId, sku: `DELETE-${marker}`, name: 'Deletion test item', slug: `deletion-test-${marker}`, price: '12.00' } });
  productId = product.id;
  const orderFields = {
    userId,
    subtotal: '12.00',
    shippingCost: '0.00',
    total: '12.00',
    currency: 'USD',
    shippingRecipient: 'Disposable Customer',
    shippingLine1: '123 Test Street',
    shippingCity: 'Test City',
    shippingCountry: 'Test Country',
  };
  const activeOrder = await prisma.order.create({ data: { ...orderFields, status: 'PREPARING', items: { create: { productId, productName: product.name, sku: product.sku, unitPrice: '12.00', quantity: 1, lineTotal: '12.00' } } } });
  await prisma.delivery.create({ data: { orderId: activeOrder.id, status: 'PREPARING', trackingCode: `TRACK-${marker}`, latitude: '33.8938', longitude: '35.5018' } });
  await prisma.order.create({ data: { ...orderFields, status: 'DELIVERED' } });
  await prisma.cart.create({ data: { userId, items: { create: { productId, quantity: 1 } } } });
  await prisma.wishlist.create({ data: { userId, items: { create: { productId } } } });
}, 60000);

afterAll(async () => {
  if (userId) {
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.securityEvent.deleteMany({ where: { type: 'ACCOUNT_DELETED', createdAt: { gte: startedAt } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
}, 60000);

describe('customer account deletion lifecycle', () => {
  it('issues Google deletion proof only for the exact linked subject and does not create a login session', async () => {
    const agent = request.agent(app);
    const identity = { sub: `delete-${marker}`, email: originalEmail, firstName: 'Disposable', lastName: 'Customer' };
    const verify = vi.spyOn(googleProvider, 'verifyCode');
    const headers = { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000', 'X-Forwarded-For': '198.51.100.21' };

    verify.mockResolvedValueOnce({ ...identity, sub: `wrong-${marker}` });
    const wrongStart = await agent.post('/api/auth/google/deletion-reauth/start').set(headers).send({ channel: crypto.randomUUID() }).expect(200);
    const wrongCallback = await agent.get('/api/auth/google/callback').query({ state: new URL(wrongStart.body.authorizationUrl).searchParams.get('state'), code: 'test-code' }).expect(200);
    expect(wrongCallback.text).toContain('failure');
    expect(wrongCallback.headers['set-cookie']?.some((cookie: string) => cookie.startsWith('electrohub_refresh='))).not.toBe(true);

    verify.mockResolvedValueOnce(identity);
    const matchingStart = await agent.post('/api/auth/google/deletion-reauth/start').set(headers).send({ channel: crypto.randomUUID() }).expect(200);
    const matchingCallback = await agent.get('/api/auth/google/callback').query({ state: new URL(matchingStart.body.authorizationUrl).searchParams.get('state'), code: 'test-code' }).expect(200);
    expect(matchingCallback.text).toContain('success');
    expect(matchingCallback.headers['set-cookie']?.some((cookie: string) => cookie.startsWith('electrohub_account_deletion_proof='))).toBe(true);
    expect(matchingCallback.headers['set-cookie']?.some((cookie: string) => cookie.startsWith('electrohub_refresh='))).not.toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(true);
    verify.mockRestore();
  }, 30000);

  it('requires password re-auth and DELETE confirmation, preserves fulfillment, removes credentials, and rejects old access', async () => {
    const agent = request.agent(app);
    const headers = { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' };

    await agent.post('/api/account/deletion/reauth/password').set(headers).send({ password: 'wrong-password' }).expect(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(true);

    await agent.post('/api/account/deletion/reauth/password').set(headers).send({ password }).expect(200);
    await agent.delete('/api/account').set(headers).send({ confirmation: 'delete' }).expect(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(true);

    await agent.delete('/api/account').set(headers).send({ confirmation: 'DELETE' }).expect(200);

    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(tombstone).toMatchObject({ email: `deleted-${userId}@deleted.invalid`, pendingEmail: null, passwordHash: null, firstName: 'Deleted', lastName: 'Customer', isActive: false, emailVerifiedAt: null });
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(0);
    expect(await prisma.otpChallenge.count({ where: { userId } })).toBe(0);
    expect(await prisma.oAuthAccount.count({ where: { userId } })).toBe(0);
    expect(await prisma.address.count({ where: { userId } })).toBe(0);
    expect(await prisma.cart.count({ where: { userId } })).toBe(0);
    expect(await prisma.wishlist.count({ where: { userId } })).toBe(0);

    const orders = await prisma.order.findMany({ where: { userId }, orderBy: { status: 'asc' } });
    expect(orders).toHaveLength(2);
    expect(orders.find(order => order.status === 'PREPARING')).toMatchObject({ shippingRecipient: 'Disposable Customer', shippingLine1: '123 Test Street', shippingCity: 'Test City', shippingCountry: 'Test Country' });
    expect(orders.find(order => order.status === 'DELIVERED')).toMatchObject({ shippingRecipient: 'Deleted customer', shippingLine1: 'Redacted', shippingCity: 'Redacted', shippingCountry: 'Redacted' });
    expect(await prisma.emailDelivery.findFirst({ where: { userId, recipient: { contains: marker } } })).toBeNull();
    expect(await prisma.emailDelivery.findFirst({ where: { userId, recipient: { endsWith: '@deleted.invalid' } } })).toMatchObject({ userId, failureReason: null });
    expect(await prisma.securityEvent.findFirst({ where: { type: 'ACCOUNT_DELETED', userId, createdAt: { gte: startedAt } } })).not.toBeNull();

    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
    await request(app).post('/api/auth/refresh').set('Cookie', `electrohub_refresh=${refreshToken}`).expect(401);
    await agent.delete('/api/account').set(headers).send({ confirmation: 'DELETE' }).expect(401);
  }, 60000);
});
