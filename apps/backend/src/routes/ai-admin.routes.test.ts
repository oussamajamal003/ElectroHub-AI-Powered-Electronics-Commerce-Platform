import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import routes from './ai-admin.routes.js';
import { resetAiServiceRuntimeForTests } from '../integrations/ai/ai.client.js';
import { requestId } from '../middleware/requestId.js';
import { errorHandler } from '../middleware/errorHandler.js';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) { res.status(401).json({ error: 'Unauthenticated' }); return; }
    req.user = { userId: 'user-1', role: req.headers.authorization === 'admin' ? 'ADMIN' : 'CUSTOMER' } as Request['user'];
    next();
  },
  requireRole: (role: string) => (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) { res.status(403).json({ error: 'Forbidden: Insufficient permissions' }); return; }
    next();
  },
}));

const KEY = 'k7Qp2Zr9Xw4Lm8Nv3Bt6Hy1Jd5Fs0Gc_AiSvc';
const AI_VARS = ['AI_SERVICE_URL', 'AI_SERVICE_API_KEY', 'AI_SERVICE_ENVIRONMENT', 'AI_SERVICE_TIMEOUT_MS'] as const;
const saved = Object.fromEntries(AI_VARS.map(name => [name, process.env[name]]));
const feature = { available: false, status: 'NOT_READY', reason: 'MODEL_NOT_LOADED', modelVersion: null, embeddingVersion: null };
const ready = { data: { status: 'ready', service: 'electrohub-ai-service', environment: 'test', apiVersion: 'v1', modelReady: false, features: { imageSearch: feature, recommendations: feature } } };

const app = express();
app.use(requestId);
app.use('/api', routes);
app.use(errorHandler);

let server: http.Server;
let origin: string;
let seen: IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader('connection', 'close');
    if (req.headers['x-electrohub-ai-key'] !== KEY) {
      res.writeHead(401, { 'content-type': 'application/json', 'x-electrohub-ai-environment': 'test' });
      res.end(JSON.stringify({ error: { code: 'AI_UNAUTHORIZED', message: 'Unauthorized', requestId: 'x' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-electrohub-ai-environment': 'test' });
    res.end(JSON.stringify(ready));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

function configure(values: Partial<Record<(typeof AI_VARS)[number], string>>) {
  for (const name of AI_VARS) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  resetAiServiceRuntimeForTests();
}

beforeEach(() => { seen = []; configure({}); });
afterEach(() => {
  for (const name of AI_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetAiServiceRuntimeForTests();
});

function expectNoLeak(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('127.0.0.1');
  expect(text).not.toContain(`:${origin.split(':').pop()}`);
  expect(text).not.toMatch(/AI_SERVICE_(URL|API_KEY)/);
}

it('requires authentication and the ADMIN role', async () => {
  expect((await request(app).get('/api/admin/ai/status')).status).toBe(401);
  expect((await request(app).get('/api/admin/ai/status').set('Authorization', 'customer')).status).toBe(403);
  expect(seen).toHaveLength(0);
});

it('reports a disabled configuration without probing', async () => {
  const res = await request(app).get('/api/admin/ai/status').set('Authorization', 'admin');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.body.data).toMatchObject({ configured: false, reason: 'NOT_CONFIGURED', reachable: false });
  expect(Date.parse(res.body.data.checkedAt)).not.toBeNaN();

  configure({ AI_SERVICE_URL: `${origin}/internal?x=1`, AI_SERVICE_API_KEY: KEY });
  const misconfigured = await request(app).get('/api/admin/ai/status').set('Authorization', 'admin');
  expect(misconfigured.body.data).toMatchObject({ configured: false, reason: 'MISCONFIGURED', reachable: false });
  expectNoLeak(misconfigured.body);
  expect(seen).toHaveLength(0);
});

it('reports a reachable AI service with the request id and service credential only', async () => {
  configure({ AI_SERVICE_URL: origin, AI_SERVICE_API_KEY: KEY, AI_SERVICE_ENVIRONMENT: 'test' });
  const res = await request(app).get('/api/admin/ai/status').set('Authorization', 'admin').set('X-Request-Id', 'admin-req-1');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({
    configured: true, reachable: true, environment: 'test', status: 'ready', modelReady: false,
    features: ready.data.features, metrics: expect.any(Object), checkedAt: expect.any(String),
  });
  expectNoLeak(res.body);
  expect(seen).toHaveLength(1);
  expect(seen[0]['x-request-id']).toBe('admin-req-1');
  expect(seen[0]['x-electrohub-ai-key']).toBe(KEY);
  expect(seen[0].authorization).toBeUndefined();
  expect(seen[0].cookie).toBeUndefined();
});

it('reports a rejected credential as unreachable with only the category and code', async () => {
  configure({ AI_SERVICE_URL: origin, AI_SERVICE_API_KEY: 'Wr0ngKeyWr0ngKeyWr0ngKeyWr0ngKey99', AI_SERVICE_ENVIRONMENT: 'test' });
  const res = await request(app).get('/api/admin/ai/status').set('Authorization', 'admin');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ configured: true, reachable: false, environment: 'test', error: { category: 'unauthorized', code: 'AI_UNAUTHORIZED' }, metrics: expect.any(Object), checkedAt: expect.any(String) });
  expect(JSON.stringify(res.body)).not.toContain('Wr0ngKey');
});

it('reports an unreachable AI service as 200 reachable:false without leaking the target', async () => {
  const closed = http.createServer();
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
  const deadOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise(resolve => closed.close(resolve));
  configure({ AI_SERVICE_URL: deadOrigin, AI_SERVICE_API_KEY: KEY, AI_SERVICE_ENVIRONMENT: 'test' });

  const res = await request(app).get('/api/admin/ai/status').set('Authorization', 'admin');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ configured: true, reachable: false, environment: 'test', error: { category: 'connect' }, metrics: expect.any(Object), checkedAt: expect.any(String) });
  expect(res.body.data.metrics["ai.get /internal/v1/ready"].failuresByCategory.connect).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(res.body.data.metrics)).not.toMatch(/127.0.0.1|http/);
  expectNoLeak(res.body);
  expect(JSON.stringify(res.body)).not.toContain(`:${deadOrigin.split(':').pop()}`);
});
