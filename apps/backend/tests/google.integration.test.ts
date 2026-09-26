import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { googleProvider } from '../src/providers/google.provider.js';
import { readGoogleTransaction } from '../src/controllers/google.controller.js';
import { GoogleService } from '../src/services/google.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { hashPassword } from '../src/utils/hash.js';
import { logger } from '../src/utils/logger.js';

const marker = crypto.randomUUID();
const email = `google-${marker}@electrohub-test.invalid`;
const password = 'OAuthTest@12345';
const identity = { sub: `google-${marker}`, email, firstName: 'Google', lastName: 'Customer' };
const service = new GoogleService();
const emails = [email, `local-${email}`, `admin-${email}`, `link-${email}`];

beforeAll(async () => {
  env.GOOGLE_CLIENT_ID = 'test-google-client';
  env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
  env.FRONTEND_URL = 'http://localhost:3000';
  env.JWT_SECRET = 'test-google-cookie-secret';
  await prisma.$connect();
}, 60000);

afterAll(async () => {
  vi.restoreAllMocks();
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  await prisma.securityEvent.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
}, 60000);

describe('Google OAuth ownership and sessions', () => {
  it('rejects tampered and expired signed OAuth transactions', () => {
    expect(() => readGoogleTransaction('tampered.signature')).toThrow();
    const payload = Buffer.from(JSON.stringify({ state: 's'.repeat(32), verifier: 'v'.repeat(32), nonce: 'n'.repeat(32), expiresAt: Date.now() - 1 })).toString('base64url');
    const signature = crypto.createHmac('sha256', env.JWT_SECRET!).update(payload).digest('base64url');
    expect(() => readGoogleTransaction(`${payload}.${signature}`)).toThrow('Google sign-in expired. Please try again.');
  });
  it('atomically creates one verified customer and identity under concurrent sign-in', async () => {
    const results = await Promise.all([service.signIn(identity), service.signIn(identity)]);
    expect(results.every(result => 'accessToken' in result)).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await prisma.oAuthAccount.count({ where: { providerAccountId: identity.sub } })).toBe(1);
  }, 60000);

  it('existing identity logs into the same user and null password fails normally', async () => {
    const result = await service.signIn(identity);
    expect('user' in result && result.user.email).toBe(email);
    await expect(new AuthService().login(email, password)).rejects.toThrow('Invalid credentials');
  }, 30000);

  it('email collision never auto-links; a verified local password proves ownership', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const localEmail = emails[1];
    const localIdentity = { ...identity, sub: `local-${marker}`, email: localEmail };
    const user = await prisma.user.create({ data: { email: localEmail, passwordHash: await hashPassword(password), firstName: 'Local', lastName: 'Customer', emailVerifiedAt: new Date(), roleId: role.id } });
    expect(await service.signIn(localIdentity)).toEqual({ linkingRequired: true });
    expect(await prisma.oAuthAccount.count({ where: { userId: user.id } })).toBe(0);
    await expect(service.link(localIdentity, 'wrong')).rejects.toMatchObject({ code: 'GOOGLE_LINK_FAILED' });
    const result = await service.link(localIdentity, password);
    expect(result.user.id).toBe(user.id);
    expect(await prisma.securityEvent.count({ where: { userId: user.id, type: 'GOOGLE_CONNECTED' } })).toBe(1);
    await expect(service.link({ ...localIdentity, sub: identity.sub }, password)).rejects.toMatchObject({ code: 'GOOGLE_LINK_CONFLICT' });
    const login = await new AuthService().login(localEmail, password);
    expect('accessToken' in login).toBe(true);
  }, 60000);

  it('rejects admin Google sessions while preserving admin password login', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const admin = await prisma.user.create({ data: { email: emails[2], firstName: 'Admin', lastName: 'Test', passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), roleId: role.id, oauthAccounts: { create: { provider: 'GOOGLE', providerAccountId: `admin-${marker}`, providerEmail: emails[2] } } } });
    await expect(service.signIn({ ...identity, sub: `admin-${marker}`, email: emails[2] })).rejects.toMatchObject({ code: 'GOOGLE_ACCOUNT_UNAVAILABLE' });
    const login = await new AuthService().login(admin.email, password);
    expect('user' in login && login.user?.role).toBe('ADMIN');
  }, 30000);

  it('validates browser state, provider failure and cancellation without provider details', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google/start').expect(302);
    const url = new URL(start.headers.location);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = url.searchParams.get('state');
    const log = vi.spyOn(logger, 'info');
    const failure = await agent.get('/api/auth/google/callback').query({ state: 'tampered', code: 'sensitive-code' }).expect(200);
    expect(log).toHaveBeenCalledWith('HTTP request', expect.objectContaining({ path: '/api/auth/google/callback' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive-code');
    expect(failure.text).toContain('failure');
    expect(failure.text).not.toContain('sensitive-code');
    const retry = await agent.get('/api/auth/google/start').expect(302);
    const cancellation = await agent.get('/api/auth/google/callback').query({ state: new URL(retry.headers.location).searchParams.get('state'), error: 'access_denied' }).expect(200);
    expect(cancellation.text).toContain('cancelled');
    const provider = vi.spyOn(googleProvider, 'verifyCode').mockRejectedValue(new Error('raw provider secret'));
    const next = await agent.get('/api/auth/google/start').expect(302);
    const unavailable = await agent.get('/api/auth/google/callback').query({ state: new URL(next.headers.location).searchParams.get('state'), code: 'test-code' }).expect(200);
    expect(unavailable.text).toContain('failure');
    expect(unavailable.text).not.toContain('raw provider secret');
    expect(provider).toHaveBeenCalledOnce();
    expect(state).toBeTruthy();
  }, 30000);

  it('valid provider callback sets existing refresh cookie; link rejects missing state/origin', async () => {
    vi.spyOn(googleProvider, 'verifyCode').mockResolvedValue(identity);
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google/start').expect(302);
    const success = await agent.get('/api/auth/google/callback').query({ state: new URL(start.headers.location).searchParams.get('state'), code: 'test-code' }).expect(200);
    expect(success.text).toContain('success');
    expect(success.headers['set-cookie'].some((cookie: string) => cookie.startsWith('electrohub_refresh='))).toBe(true);
    await request(app).post('/api/auth/google/link').set('Origin', 'https://attacker.invalid').send({ password }).expect(403);
    await request(app).post('/api/auth/google/link').set('Origin', 'http://localhost:3000').send({ password }).expect(400);
  }, 30000);

  it('links through the HTTP boundary only after password proof and then supports refresh, me and logout', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const local = { ...identity, sub: `http-link-${marker}`, email: emails[3] };
    await prisma.user.create({ data: { email: local.email, passwordHash: await hashPassword(password), firstName: 'Link', lastName: 'Customer', emailVerifiedAt: new Date(), roleId: role.id } });
    vi.spyOn(googleProvider, 'verifyCode').mockResolvedValue(local);
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google/start').expect(302);
    const callback = await agent.get('/api/auth/google/callback').query({ state: new URL(start.headers.location).searchParams.get('state'), code: 'test-code' }).expect(200);
    expect(callback.text).toContain('linking_required');
    expect(callback.headers['set-cookie'].every((cookie: string) => !cookie.startsWith('electrohub_refresh='))).toBe(true);
    await agent.post('/api/auth/google/link').set('Origin', 'http://localhost:3000').send({ password: 'wrong' }).expect(400);
    const linked = await agent.post('/api/auth/google/link').set('Origin', 'http://localhost:3000').send({ password }).expect(200);
    await agent.get('/api/auth/me').set('Authorization', `Bearer ${linked.body.accessToken}`).expect(200);
    const refresh = await agent.post('/api/auth/refresh').expect(200);
    expect(refresh.body.accessToken).toBeTruthy();
    await agent.post('/api/auth/logout').expect(200);
    await agent.post('/api/auth/refresh').expect(401);
  }, 60000);
});
