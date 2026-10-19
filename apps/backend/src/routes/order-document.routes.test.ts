import type { IncomingMessage } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createOrderDocumentRouter } from './order-document.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { RenderError, RenderPool, type RenderFailureCode } from '../documents/render-pool.js';
import { OrderDocumentService } from '../services/order-document.service.js';
import { logSafely } from '../utils/logger.js';
import type { DocumentSourceOrder } from '../services/order-document.domain.js';
import { ORDER_ID, USER_ID, paidOrder, withPayment } from '../services/__tests__/order-document.fixtures.js';
import { JWT_SECRET, generateAccessToken } from '../utils/jwt.js';

// Task 03.9 document route contract tests. Persistence is mocked (no database). The binary path uses a real RenderPool worker;
// failure and concurrency paths use a fake pool. These prove route/auth/validation/header/ownership behavior, not PostgreSQL semantics.
const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  order: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  payment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  cartItem: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  inventory: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  commerceEmailOutbox: { create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));

const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNKNOWN_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANONICAL = `ORD-${ORDER_ID.toUpperCase()}`;
const OTHER_CANONICAL = `ORD-${OTHER_ORDER_ID.toUpperCase()}`;
const UNKNOWN_CANONICAL = `ORD-${UNKNOWN_ORDER_ID.toUpperCase()}`;
const BASE = `/api/orders/${CANONICAL}/documents`;
const metadataPath = (reference = CANONICAL) => `/api/orders/${reference}/documents`;
const filePath = (kind: string, reference = CANONICAL) => `${metadataPath(reference)}/${kind}`;

/** Owner-scoped order store keyed by `${userId}:${orderId}`: the mock returns a row only for the exact owner + id pair. */
const orderStore = new Map<string, DocumentSourceOrder>();
const roles = new Map<string, string>();
const setOrder = (order: DocumentSourceOrder) => orderStore.set(`${order.userId}:${order.id}`, order);

const PRIVATE_HEADERS = {
  'cache-control': 'private, no-store, max-age=0',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const STUB_PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(80, 0x20), Buffer.from('\n%%EOF\n')]);
const SIDE_EFFECT_FNS = [
  db.order.create, db.order.update, db.order.updateMany, db.order.delete,
  db.payment.create, db.payment.update, db.payment.updateMany, db.payment.delete,
  db.cartItem.create, db.cartItem.update, db.cartItem.updateMany, db.cartItem.delete, db.cartItem.deleteMany,
  db.inventory.create, db.inventory.update, db.inventory.updateMany,
  db.commerceEmailOutbox.create, db.commerceEmailOutbox.createMany, db.commerceEmailOutbox.update,
  db.commerceEmailOutbox.updateMany, db.commerceEmailOutbox.findMany,
  db.$transaction, db.$queryRaw, db.$executeRaw,
];
const sideEffectCalls = () => SIDE_EFFECT_FNS.reduce((sum, fn) => sum + fn.mock.calls.length, 0);

const realPool = new RenderPool({ size: 1 });
afterAll(async () => {
  await realPool.close();
});

type RenderResult = { bytes: Buffer; pageCount: number };
function fakePool(impl: (...args: unknown[]) => Promise<RenderResult> = async () => ({ bytes: STUB_PDF, pageCount: 1 }), workers = 1) {
  const render = vi.fn(impl);
  const pool = { render, stats: () => ({ workers, busy: 0, queued: 0, timeouts: 0, maxQueue: 8 }) };
  return { pool: pool as unknown as RenderPool, render };
}

interface AppOptions { pool?: RenderPool; ready?: () => boolean; unavailableCause?: () => 'FEATURE_DISABLED' | 'REQUIRED_ASSET_UNAVAILABLE' | 'RENDERER_POOL_UNAVAILABLE' | null; fileLimit?: number }
function buildApp({ pool = realPool, ready = () => true, unavailableCause, fileLimit = 1000 }: AppOptions = {}) {
  const service = new OrderDocumentService(db as unknown as ConstructorParameters<typeof OrderDocumentService>[0], () => pool, ready, unavailableCause);
  const app = express();
  app.use('/api', createOrderDocumentRouter({ service, fileLimit, metadataLimit: 1000 }));
  app.use(errorHandler);
  return app;
}

const bearer = (userId = USER_ID, role = 'CUSTOMER') => `Bearer ${generateAccessToken({ userId, role })}`;
const expiredBearer = () => {
  const now = Math.floor(Date.now() / 1000);
  return `Bearer ${jwt.sign({ userId: USER_ID, role: 'CUSTOMER', iat: now - 3600, exp: now - 60 }, JWT_SECRET, { algorithm: 'HS256' })}`;
};

/** Collects a binary body without JSON/text parsing (required for PDF bytes). */
const parseBinary = (res: IncomingMessage, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('error', error => callback(error, Buffer.alloc(0)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

const getJson = (app: express.Express, path: string, userId = USER_ID) =>
  request(app).get(path).set('Authorization', bearer(userId));
const getPdf = (app: express.Express, path: string, userId = USER_ID, headers: Record<string, string> = {}) =>
  request(app).get(path).set('Authorization', bearer(userId)).set(headers).buffer(true).parse(parseBinary as unknown as (res: request.Response, callback: (err: Error | null, body: unknown) => void) => void);

beforeEach(() => {
  vi.resetAllMocks();
  roles.clear();
  roles.set(USER_ID, 'CUSTOMER');
  roles.set(OTHER_USER_ID, 'CUSTOMER');
  roles.set(ADMIN_USER_ID, 'ADMIN');
  orderStore.clear();
  setOrder(paidOrder());
  setOrder(paidOrder({ id: OTHER_ORDER_ID, userId: OTHER_USER_ID, paymentAttempt: { ...paidOrder().paymentAttempt!, userId: OTHER_USER_ID } }));
  db.user.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const role = roles.get(where.id);
    return role ? { id: where.id, role: { name: role } } : null;
  });
  db.order.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    orderStore.get(`${where.userId}:${where.id}`) ?? null);
});

describe('authentication and role', () => {
  const cases: [string, string][] = [['metadata', metadataPath()], ['file', filePath('invoice')]];

  it.each(cases)('rejects a request without Authorization on %s with 401 and no order lookup', async (_name, path) => {
    const fake = fakePool();
    const res = await request(buildApp({ pool: fake.pool })).get(path);
    expect(res.status).toBe(401);
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(db.order.findFirst).not.toHaveBeenCalled();
    expect(fake.render).not.toHaveBeenCalled();
  });

  it.each(cases)('rejects a malformed Authorization header on %s', async (_name, path) => {
    const fake = fakePool();
    const app = buildApp({ pool: fake.pool });
    const basic = await request(app).get(path).set('Authorization', 'Basic Zm9vOmJhcg==');
    const garbage = await request(app).get(path).set('Authorization', 'Bearer not.a.jwt');
    expect(basic.status).toBe(401);
    expect(garbage.status).toBe(401);
    expect(garbage.headers).toMatchObject(PRIVATE_HEADERS);
    expect(db.order.findFirst).not.toHaveBeenCalled();
    expect(fake.render).not.toHaveBeenCalled();
  });

  it.each(cases)('rejects an expired token on %s with 401 and no order lookup', async (_name, path) => {
    const fake = fakePool();
    const res = await request(buildApp({ pool: fake.pool })).get(path).set('Authorization', expiredBearer());
    expect(res.status).toBe(401);
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(db.order.findFirst).not.toHaveBeenCalled();
    expect(fake.render).not.toHaveBeenCalled();
  });

  it.each(cases)('rejects an inactive or missing account on %s with 401', async (_name, path) => {
    roles.delete(USER_ID);
    const res = await getJson(buildApp(), path);
    expect(res.status).toBe(401);
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });

  it.each(cases)('rejects an ADMIN account on %s with 403 and no order lookup', async (_name, path) => {
    const res = await request(buildApp()).get(path).set('Authorization', bearer(ADMIN_USER_ID, 'ADMIN'));
    expect(res.status).toBe(403);
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('metadata DTO', () => {
  it('returns three ordered owner entries with canonical reference, paths, filenames and no internal identifiers', async () => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool }), metadataPath());
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(fake.render).not.toHaveBeenCalled();
    expect(res.body.data.orderReference).toBe(CANONICAL);
    const documents = res.body.data.documents;
    expect(documents.map((doc: { kind: string }) => doc.kind)).toEqual(['invoice', 'receipt', 'summary']);
    expect(documents.map((doc: { label: string }) => doc.label))
      .toEqual(['Order invoice (non-tax)', 'Payment receipt', 'Order summary']);
    for (const doc of documents) {
      expect(doc).toMatchObject({ availability: 'AVAILABLE', reasonCode: null, mediaType: 'application/pdf', issuedAt: null, policy: 'COMMERCIAL_V1' });
      expect(doc.filename).toBe(`ElectroHub-${CANONICAL}-${doc.kind}.pdf`);
      expect(doc.contentVersion).toMatch(/^v1\.[0-9a-f]{32}$/);
      expect(doc.previewPath).toBe(`${BASE}/${doc.kind}?disposition=inline`);
      expect(doc.downloadPath).toBe(`${BASE}/${doc.kind}?disposition=attachment`);
    }
    expect(documents[0].paidAt).toBe('2026-10-01T10:00:05.000Z');
    const text = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['providerpaymentid', 'pi_synthetic', 'phone']) expect(text).not.toContain(forbidden);
  });

  it('marks invoice and receipt UNAVAILABLE for a pending payment while the summary stays AVAILABLE', async () => {
    setOrder(withPayment(paidOrder(), { status: 'PENDING', paidAt: null, refundedAt: null }));
    const res = await getJson(buildApp(), metadataPath());
    expect(res.status).toBe(200);
    const [invoice, receipt, summary] = res.body.data.documents;
    for (const doc of [invoice, receipt]) {
      expect(doc).toMatchObject({
        availability: 'UNAVAILABLE', reasonCode: 'PAYMENT_NOT_CONFIRMED', filename: null, contentVersion: null, previewPath: null, downloadPath: null,
      });
    }
    expect(summary).toMatchObject({ availability: 'AVAILABLE', reasonCode: null, paidAt: null });
    expect(summary.filename).toBe(`ElectroHub-${CANONICAL}-summary.pdf`);
  });

  it('accepts a lowercase canonical reference and a legacy bare UUID, both queried with the lowercase id', async () => {
    const lower = await getJson(buildApp(), metadataPath(CANONICAL.toLowerCase()));
    expect(lower.status).toBe(200);
    expect(db.order.findFirst.mock.calls[0]![0].where).toEqual({ id: ORDER_ID, userId: USER_ID });
    const legacy = await getJson(buildApp(), `/api/orders/${ORDER_ID}/documents`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.orderReference).toBe(CANONICAL);
  });

  it('returns UNAVAILABLE DOCUMENTS_UNAVAILABLE entries when the feature is disabled', async () => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool, ready: () => false, unavailableCause: () => 'FEATURE_DISABLED' }), metadataPath());
    expect(res.status).toBe(200);
    expect(res.body.data.documents).toHaveLength(3);
    for (const doc of res.body.data.documents) {
      expect(doc).toMatchObject({
        availability: 'UNAVAILABLE', reasonCode: 'DOCUMENTS_UNAVAILABLE', filename: null, contentVersion: null, previewPath: null, downloadPath: null,
      });
    }
    expect(fake.render).not.toHaveBeenCalled();
    expect(logSafely).toHaveBeenCalledWith('warn', 'Order documents unavailable.', expect.objectContaining({
      event: 'document_availability_changed', state: 'unavailable', reason: 'FEATURE_DISABLED',
    }));
  });

  it('identifies missing required assets in a bounded diagnostic without customer or filesystem data', async () => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool, ready: () => false,
      unavailableCause: () => 'REQUIRED_ASSET_UNAVAILABLE' }), metadataPath());
    expect(res.status).toBe(200);
    expect(res.body.data.documents.every((entry: { availability: string }) => entry.availability === 'UNAVAILABLE')).toBe(true);
    expect(logSafely).toHaveBeenCalledWith('warn', 'Order documents unavailable.', expect.objectContaining({
      event: 'document_availability_changed', state: 'unavailable', reason: 'REQUIRED_ASSET_UNAVAILABLE',
    }));
    const diagnostic = JSON.stringify(vi.mocked(logSafely).mock.calls);
    expect(diagnostic).not.toContain(USER_ID);
    expect(diagnostic).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
    expect(fake.render).not.toHaveBeenCalled();
    const pdfResponse = await getJson(buildApp({ pool: fake.pool, ready: () => false,
      unavailableCause: () => 'REQUIRED_ASSET_UNAVAILABLE' }), filePath('invoice'));
    expect(pdfResponse.status).toBe(503);
    expect(pdfResponse.body.error.code).toBe('DOCUMENTS_UNAVAILABLE');
    expect(fake.render).not.toHaveBeenCalled();
  });
});

describe('ownership and existence disclosure', () => {
  it('returns byte-identical 404 bodies for another owner and an unknown order, for metadata and file', async () => {
    const app = buildApp();
    // User B requests owner A's real order; user A requests a nonexistent order id.
    const otherMeta = await getJson(app, metadataPath(), OTHER_USER_ID);
    const unknownMeta = await getJson(app, metadataPath(UNKNOWN_CANONICAL), USER_ID);
    const otherFile = await getJson(app, filePath('invoice'), OTHER_USER_ID);
    const unknownFile = await getJson(app, filePath('invoice', UNKNOWN_CANONICAL), USER_ID);
    for (const res of [otherMeta, unknownMeta, otherFile, unknownFile]) {
      expect(res.status).toBe(404);
      expect(res.headers).toMatchObject(PRIVATE_HEADERS);
      expect(res.body).toEqual({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } });
    }
    expect(unknownMeta.text).toBe(otherMeta.text);
    expect(unknownFile.text).toBe(otherFile.text);
    expect(db.order.findFirst.mock.calls[0]![0].where).toEqual({ id: ORDER_ID, userId: OTHER_USER_ID });
    expect(db.order.findFirst.mock.calls[1]![0].where).toEqual({ id: UNKNOWN_ORDER_ID, userId: USER_ID });
  });

  it('answers another customer requesting the same order id with 404 (owner-scoped lookup, no render)', async () => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool }), filePath('receipt'), OTHER_USER_ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(db.order.findFirst.mock.calls[0]![0].where).toEqual({ id: ORDER_ID, userId: OTHER_USER_ID });
    expect(fake.render).not.toHaveBeenCalled();
  });
});

describe('request validation', () => {
  it.each([
    'not-a-reference',
    'ORD-',
    'ORD-7c9e6679-7425-40de-944b-e07fc1f90ae',
    `ORD-${'a'.repeat(40)}`,
    'ORD-abc%2F..',
    encodeURIComponent("ORD-' OR 1=1 --"),
  ])('rejects malformed reference %s on metadata and file with 400 and no lookup or render', async reference => {
    const fake = fakePool();
    const app = buildApp({ pool: fake.pool });
    const meta = await getJson(app, metadataPath(reference));
    const file = await getJson(app, filePath('invoice', reference));
    for (const res of [meta, file]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_REFERENCE_INVALID');
      expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    }
    expect(db.order.findFirst).not.toHaveBeenCalled();
    expect(fake.render).not.toHaveBeenCalled();
  });

  it.each([
    ['kind plural', `${filePath('invoices')}`],
    ['disposition download', `${filePath('invoice')}?disposition=download`],
    ['duplicate disposition', `${filePath('invoice')}?disposition=inline&disposition=attachment`],
    ['unknown query key', `${filePath('invoice')}?foo=bar`],
  ])('rejects %s on the file route with 400 DOCUMENT_REQUEST_INVALID and no render', async (_name, path) => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool }), path);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_REQUEST_INVALID');
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(fake.render).not.toHaveBeenCalled();
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });

  it.each(['?x=1', '?disposition=inline'])('rejects any query %s on the metadata route with 400', async query => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool }), `${metadataPath()}${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DOCUMENT_REQUEST_INVALID');
    expect(db.order.findFirst).not.toHaveBeenCalled();
    expect(fake.render).not.toHaveBeenCalled();
  });
});

describe('method policy', () => {
  it.each(['head', 'post', 'put', 'delete'] as const)('answers %s with 405 and Allow: GET on both routes without effects', async method => {
    const fake = fakePool();
    const app = buildApp({ pool: fake.pool });
    for (const path of [metadataPath(), filePath('invoice')]) {
      const send = () => {
        const agent = request(app);
        if (method === 'head') return agent.head(path);
        if (method === 'post') return agent.post(path);
        if (method === 'put') return agent.put(path);
        return agent.delete(path);
      };
      const res = await send().set('Authorization', bearer());
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    }
    expect(fake.render).not.toHaveBeenCalled();
    expect(db.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('file download', () => {
  it('returns a complete PDF with the documented headers for the default attachment disposition', async () => {
    const app = buildApp();
    const meta = await getJson(app, metadataPath());
    const res = await getPdf(app, filePath('invoice'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const filename = `ElectroHub-${CANONICAL}-invoice.pdf`;
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    expect(res.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
    expect(res.headers['x-document-version']).toMatch(/^v1\.[0-9a-f]{32}$/);
    expect(res.headers['x-document-version']).toBe(meta.body.data.documents[0].contentVersion);
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers['accept-ranges']).toBeUndefined();
  }, 60_000);

  it('uses an inline disposition with byte-identical content for disposition=inline', async () => {
    const app = buildApp();
    const attachment = await getPdf(app, filePath('summary'));
    const inline = await getPdf(app, `${filePath('summary')}?disposition=inline`);
    expect(inline.status).toBe(200);
    const filename = `ElectroHub-${CANONICAL}-summary.pdf`;
    expect(inline.headers['content-disposition']).toBe(`inline; filename="${filename}"; filename*=UTF-8''${filename}`);
    expect(inline.body.equals(attachment.body)).toBe(true);
    expect(inline.headers['x-document-version']).toBe(attachment.headers['x-document-version']);
  }, 60_000);

  it('ignores a Range header and still returns the full 200 PDF', async () => {
    const app = buildApp();
    const full = await getPdf(app, filePath('invoice'));
    const ranged = await getPdf(app, filePath('invoice'), USER_ID, { Range: 'bytes=0-9' });
    expect(ranged.status).toBe(200);
    expect(ranged.body.length).toBe(full.body.length);
    expect(ranged.headers['content-range']).toBeUndefined();
    expect(ranged.headers['accept-ranges']).toBeUndefined();
  }, 60_000);

  it('serves the bare-UUID legacy reference on the file route', async () => {
    const res = await getPdf(buildApp(), `/api/orders/${ORDER_ID}/documents/summary`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(`ElectroHub-${CANONICAL}-summary.pdf`);
  }, 60_000);

  it('returns 409 DOCUMENT_NOT_AVAILABLE for a receipt on a pending payment without rendering', async () => {
    setOrder(withPayment(paidOrder(), { status: 'PENDING', paidAt: null, refundedAt: null }));
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool }), filePath('receipt'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_NOT_AVAILABLE');
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(fake.render).not.toHaveBeenCalled();
  });

  it('returns 422 DOCUMENT_DATA_INVALID for an order whose total does not reconcile, without rendering', async () => {
    setOrder(paidOrder({ total: new Prisma.Decimal('1.00') }));
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool }), filePath('invoice'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DOCUMENT_DATA_INVALID');
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(fake.render).not.toHaveBeenCalled();
  });

  it('returns 503 DOCUMENTS_UNAVAILABLE when the feature is disabled, without rendering', async () => {
    const fake = fakePool();
    const res = await getJson(buildApp({ pool: fake.pool, ready: () => false, unavailableCause: () => 'FEATURE_DISABLED' }), filePath('invoice'));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DOCUMENTS_UNAVAILABLE');
    expect(res.headers['retry-after']).toBeDefined();
    expect(fake.render).not.toHaveBeenCalled();
  });
});

describe('render failure translation', () => {
  const failureCases: [RenderFailureCode, number, string, boolean][] = [
    ['QUEUE_FULL', 503, 'DOCUMENTS_UNAVAILABLE', true],
    ['TIMEOUT', 503, 'DOCUMENT_GENERATION_TIMEOUT', true],
    ['PAGE_LIMIT', 422, 'DOCUMENT_LIMIT_EXCEEDED', false],
    ['UNSUPPORTED_GLYPH', 422, 'DOCUMENT_DATA_INVALID', false],
    ['RENDER_FAILED', 500, 'DOCUMENT_GENERATION_FAILED', false],
  ];

  it.each(failureCases)('maps %s to %i %s as JSON with no PDF or internal detail', async (code, status, errorCode, retryAfter) => {
    const fake = fakePool(() => Promise.reject(new RenderError(code)));
    const res = await getJson(buildApp({ pool: fake.pool }), filePath('invoice'));
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: { code: errorCode, message: expect.any(String) } });
    expect(res.headers).toMatchObject(PRIVATE_HEADERS);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|\.ts|node_modules|[A-Za-z]:\\|\/src\//);
    if (retryAfter) expect(res.headers['retry-after']).toBeDefined();
    else expect(res.headers['retry-after']).toBeUndefined();
  });

  it('reports full renderer-pool unavailability once until recovery, not a single worker failure', async () => {
    const healthy = fakePool();
    expect((await getPdf(buildApp({ pool: healthy.pool }), filePath('invoice'))).status).toBe(200);
    const partialFailure = fakePool(() => Promise.reject(new RenderError('RENDER_FAILED')), 1);
    for (let index = 0; index < 2; index++) {
      const res = await getPdf(buildApp({ pool: partialFailure.pool }), filePath('invoice'));
      expect(res.status).toBe(500);
    }
    expect(vi.mocked(logSafely).mock.calls.filter(([, , fields]) => fields?.event === 'document_renderer_pool_changed')).toHaveLength(0);

    const unavailable = fakePool(() => Promise.reject(new RenderError('RENDER_FAILED')), 0);
    for (let index = 0; index < 2; index++) {
      const res = await getPdf(buildApp({ pool: unavailable.pool }), filePath('invoice'));
      expect(res.status).toBe(500);
    }
    const recovered = fakePool();
    expect((await getPdf(buildApp({ pool: recovered.pool }), filePath('invoice'))).status).toBe(200);
    const transitions = vi.mocked(logSafely).mock.calls.filter(([level, _message, fields]) =>
      level === 'warn' && fields?.event === 'document_renderer_pool_changed');
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual(expect.arrayContaining(['warn', 'Document renderer pool unavailable.', expect.objectContaining({
      event: 'document_renderer_pool_changed', state: 'unavailable', reason: 'RENDER_FAILED',
    })]));
    expect(logSafely).toHaveBeenCalledWith('info', 'Document renderer pool recovered.', expect.objectContaining({
      event: 'document_renderer_pool_changed', state: 'available',
    }));
  });

  it('maps an unexpected non-render error to 500 DOCUMENT_GENERATION_FAILED without echoing its message', async () => {
    const fake = fakePool(() => Promise.reject(new Error('boom at /secret/path/render.ts')));
    const res = await getJson(buildApp({ pool: fake.pool }), filePath('invoice'));
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.error.code).toBe('DOCUMENT_GENERATION_FAILED');
    expect(JSON.stringify(res.body)).not.toMatch(/boom|secret|\.ts/);
  });
});

describe('concurrency and rate limits', () => {
  it('allows one in-flight generation per customer without blocking another customer', async () => {
    const resolvers: ((value: RenderResult) => void)[] = [];
    const fake = fakePool(() => new Promise<RenderResult>(resolve => { resolvers.push(resolve); }));
    const app = buildApp({ pool: fake.pool });
    const first = getPdf(app, filePath('invoice')).then(res => res);
    await vi.waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1));
    const second = await getJson(app, filePath('invoice'));
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    expect(second.headers['retry-after']).toBeDefined();
    const other = getPdf(app, filePath('invoice', OTHER_CANONICAL), OTHER_USER_ID).then(res => res);
    await vi.waitFor(() => expect(fake.render).toHaveBeenCalledTimes(2));
    for (const resolve of resolvers) resolve({ bytes: STUB_PDF, pageCount: 1 });
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
  });

  it('returns 429 RATE_LIMITED on the third file request when the file limit is 2', async () => {
    const fake = fakePool();
    const app = buildApp({ pool: fake.pool, fileLimit: 2 });
    expect((await getPdf(app, filePath('summary'))).status).toBe(200);
    expect((await getPdf(app, filePath('summary'))).status).toBe(200);
    const limited = await getJson(app, filePath('summary'));
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers).toMatchObject(PRIVATE_HEADERS);
    expect(fake.render).toHaveBeenCalledTimes(2);
  });
});

describe('side effects', () => {
  it('performs no order, payment, cart, inventory, outbox, transaction or raw SQL calls across document requests', async () => {
    const fake = fakePool();
    const app = buildApp({ pool: fake.pool });
    await getJson(app, metadataPath());
    expect((await getPdf(app, filePath('invoice'))).status).toBe(200);
    await request(app).post(filePath('invoice')).set('Authorization', bearer());
    await getJson(app, filePath('invoice', 'ORD-NOPE'));
    await getJson(app, filePath('invoice', OTHER_CANONICAL));
    expect(db.order.findFirst).toHaveBeenCalled();
    expect(sideEffectCalls()).toBe(0);
  });
});
