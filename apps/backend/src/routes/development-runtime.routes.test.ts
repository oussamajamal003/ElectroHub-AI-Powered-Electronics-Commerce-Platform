import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import router from './development-runtime.routes.js';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
const app = express(); app.use('/api', router);
const prior = { ...process.env };
const token = 'a'.repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, { NODE_ENV: 'development', ELECTROHUB_DEV_DIAGNOSTIC_TOKEN: token,
    DATABASE_URL: 'postgresql://postgres:unit@localhost:55434/electrohub_disposable',
    DIRECT_URL: 'postgresql://postgres:unit@localhost:55434/electrohub_disposable' });
  db.$queryRaw.mockResolvedValue([{ database: 'electrohub_disposable', port: 55434, address: '127.0.0.1', tls: true }]);
});
afterEach(() => { process.env = { ...prior }; });

it('requires the private token before any database read and returns no public diagnostic', async () => {
  for (const value of ['', 'Bearer wrong', `Bearer ${'b'.repeat(64)}`]) {
    expect((await request(app).get('/api/internal/development-runtime').set('Authorization', value)).status).toBe(404);
  }
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
it('never enables the diagnostic in production', async () => {
  process.env.NODE_ENV = 'production';
  expect((await request(app).get('/api/internal/development-runtime').auth(token, { type: 'bearer' })).status).toBe(404);
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
it('returns an instance binding only after a real identity/TLS check', async () => {
  const response = await request(app).get('/api/internal/development-runtime').auth(token, { type: 'bearer' });
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.data).toEqual({ mode: 'ISOLATED_QA', instanceId: expect.any(String), databaseReady: true, tlsVerified: true });
  expect(JSON.stringify(response.body)).not.toMatch(/postgres|55434|localhost|unit|DATABASE_URL/);
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
});
it.each([
  { database: 'postgres', port: 5432, address: '10.0.0.1', tls: true },
  { database: 'electrohub_disposable', port: 55434, address: '127.0.0.1', tls: false },
  { database: 'electrohub_disposable', port: 55434, address: '10.0.0.1', tls: true },
])('fails closed if observed server identity or TLS differs', async row => {
  db.$queryRaw.mockResolvedValue([row]);
  const response = await request(app).get('/api/internal/development-runtime').auth(token, { type: 'bearer' });
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: { code: 'DEVELOPMENT_RUNTIME_NOT_READY' } });
});
