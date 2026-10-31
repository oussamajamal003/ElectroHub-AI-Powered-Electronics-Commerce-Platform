/**
 * Task 04.5 HTTP contract + security against the real Express app and a DISPOSABLE PostgreSQL (scripts/delivery-pg.cjs only).
 * Covers T5-11 (IDOR), T5-12 (role), T5-13 (validation), AC5 (customer DTO allowlist), the revision-conflict body and cache headers.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAccessToken } from '../utils/jwt.js';
import { deliveryFixtures } from '../services/__tests__/helpers/delivery-fixtures.js';

const enabled = process.env.DELIVERY_PG_RUN === '1';
// Loaded only inside the disposable runner: elsewhere the database client refuses non-disposable targets and this suite skips.
let app: Express;
let prisma: typeof import('../lib/prisma.js').prisma;
const fixtures = deliveryFixtures('http');
const bearer = (user: { id: string }, role: string) => `Bearer ${generateAccessToken({ userId: user.id, role })}`;

/** Every key anywhere in a JSON value, so a forbidden field cannot hide inside a nested object. */
function keys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => keys(item, found));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { found.add(key); keys(child, found); }
  return found;
}

describe.skipIf(!enabled).sequential('Task 04.5 delivery HTTP contract on real PostgreSQL', () => {
  let admin: { id: string; email: string }; let owner: { id: string }; let stranger: { id: string };
  let order: Awaited<ReturnType<typeof fixtures.order>>;

  beforeAll(async () => {
    // Under this file's CommonJS typing a dynamic import types `default` as the namespace; at runtime it is the Express app.
    app = (await import('../app.js') as unknown as { default: Express }).default;
    ({ prisma } = await import('../lib/prisma.js'));
    admin = await fixtures.user('ADMIN', 'admin');
    owner = await fixtures.user('CUSTOMER', 'owner');
    stranger = await fixtures.user('CUSTOMER', 'stranger');
    order = await fixtures.order(owner.id, 'CONFIRMED', 'SUCCEEDED');
  });
  afterAll(async () => {
    expect(await fixtures.cleanup()).toBe(0);
    await prisma.$disconnect();
  });

  it('customer GET: 401 without a token, 403 for an ADMIN token, 400 malformed, 404 unknown and other-customer (T5-11)', async () => {
    const path = `/api/orders/${order.reference}/delivery`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set('Authorization', bearer(admin, 'ADMIN'))).status).toBe(403);
    const malformed = await request(app).get('/api/orders/ORD-nope/delivery').set('Authorization', bearer(owner, 'CUSTOMER'));
    expect([malformed.status, malformed.body.error.code]).toEqual([400, 'ORDER_REFERENCE_INVALID']);
    const strangerRead = await request(app).get(path).set('Authorization', bearer(stranger, 'CUSTOMER'));
    const unknownRead = await request(app).get('/api/orders/ORD-00000000-0000-4000-8000-000000000000/delivery').set('Authorization', bearer(stranger, 'CUSTOMER'));
    expect([strangerRead.status, unknownRead.status]).toEqual([404, 404]);
    expect(strangerRead.body).toEqual(unknownRead.body);
    const own = await request(app).get(path).set('Authorization', bearer(owner, 'CUSTOMER'));
    expect(own.status).toBe(200);
    expect(own.headers['cache-control']).toBe('no-store');
    expect(own.body.data).toMatchObject({ availability: 'NOT_STARTED', revision: 0, orderReference: order.reference });
  });

  it('T5-12 customer tokens cannot reach any admin delivery route; admin responses are private, no-store', async () => {
    const adminPath = `/api/admin/orders/${order.reference}/delivery`;
    const customer = bearer(owner, 'CUSTOMER');
    expect((await request(app).get('/api/admin/deliveries').set('Authorization', customer)).status).toBe(403);
    expect((await request(app).get(adminPath).set('Authorization', customer)).status).toBe(403);
    expect((await request(app).post(adminPath).set('Authorization', customer).send({})).status).toBe(403);
    expect((await request(app).patch(adminPath).set('Authorization', customer).send({ expectedRevision: 1, status: 'PREPARING' })).status).toBe(403);
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(0);
    const list = await request(app).get('/api/admin/deliveries?pageSize=50').set('Authorization', bearer(admin, 'ADMIN'));
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body.data.some((row: { orderReference: string }) => row.orderReference === order.reference)).toBe(true);
    expect((await request(app).get('/api/admin/deliveries?pageSize=51').set('Authorization', bearer(admin, 'ADMIN'))).status).toBe(400);
  });

  it('admin Start → PATCH with strict validation (T5-13), conflict body carries the current snapshot', async () => {
    const adminPath = `/api/admin/orders/${order.reference}/delivery`;
    const auth = bearer(admin, 'ADMIN');
    const started = await request(app).post(adminPath).set('Authorization', auth).send({});
    expect([started.status, started.body.data.revision]).toEqual([201, 1]);
    expect((await request(app).post(adminPath).set('Authorization', auth).send({})).status).toBe(200);
    expect((await request(app).post(adminPath).set('Authorization', auth).send({ isSimulated: true })).status).toBe(400);

    for (const body of [
      { expectedRevision: 1, status: 'PREPARING', userId: owner.id },
      { expectedRevision: 1, status: 'PREPARING', paymentStatus: 'SUCCEEDED' },
      { expectedRevision: 1, location: { latitude: 91, longitude: 0 } },
      { expectedRevision: 1, location: { latitude: 0, longitude: 535 } },
      { expectedRevision: 1, location: { latitude: 'NaN', longitude: 0 } },
      { expectedRevision: 1, estimatedAt: new Date(Date.now() - 3_600_000).toISOString() },
      { expectedRevision: 1, estimatedAt: new Date(Date.now() + 31 * 86_400_000).toISOString() },
      { expectedRevision: 1, status: 'CANCELLED' },
      { expectedRevision: 1, note: 'only a note' },
      { expectedRevision: 0, status: 'PREPARING' },
    ]) {
      const response = await request(app).patch(adminPath).set('Authorization', auth).send(body);
      expect([response.status, response.body.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
      expect(JSON.stringify(response.body)).not.toMatch(/535|91|only a note/);
    }

    const accepted = await request(app).patch(adminPath).set('Authorization', auth).send({ expectedRevision: 1, status: 'PREPARING', note: 'Packed at bay 4' });
    expect([accepted.status, accepted.body.meta.changed, accepted.body.data.current.revision]).toEqual([200, true, 2]);
    expect(accepted.body.data.history[0]).toMatchObject({ note: 'Packed at bay 4', actorEmail: admin.email, source: 'ADMIN' });

    const stale = await request(app).patch(adminPath).set('Authorization', auth).send({ expectedRevision: 1, status: 'PREPARING' });
    expect([stale.status, stale.body.error.code, stale.body.snapshot.current.revision]).toEqual([409, 'DELIVERY_REVISION_CONFLICT', 2]);
    const premature = await request(app).patch(adminPath).set('Authorization', auth).send({ expectedRevision: 2, location: { latitude: 1, longitude: 2 } });
    expect([premature.status, premature.body.error.code]).toEqual([409, 'DELIVERY_LOCATION_NOT_ALLOWED']);
  });

  // location.source (MANUAL | SIMULATED) is part of the approved §5.1 contract; the admin-only event source never is.
  it('AC5 customer DTO allowlist: no actor, note, event source, admin email, provider ids or event coordinates', async () => {
    const auth = bearer(admin, 'ADMIN');
    await request(app).patch(`/api/admin/orders/${order.reference}/delivery`).set('Authorization', auth)
      .send({ expectedRevision: 2, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.8938, longitude: 35.5018, label: 'Hub' }, note: 'Secret admin note' });
    const response = await request(app).get(`/api/orders/${order.reference}/delivery`).set('Authorization', bearer(owner, 'CUSTOMER'));
    expect(response.status).toBe(200);
    const found = keys(response.body);
    for (const forbidden of ['actorUserId', 'actorEmail', 'note', 'history', 'changes', 'orderId', 'customer', 'providerPaymentId', 'userId', 'email', 'fromStatus']) {
      expect(found.has(forbidden), forbidden).toBe(false);
    }
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('Secret admin note');
    expect(text).not.toContain(admin.email);
    expect([...keys(response.body.data)].filter(key => !found.has(key))).toEqual([]);
    expect(Object.keys(response.body.data).sort()).toEqual(['availability', 'deliveredAt', 'deliveryMethod', 'eta', 'isSimulated', 'location',
      'map', 'orderReference', 'paymentState', 'revision', 'serverTime', 'status', 'timeline', 'trackingReference'].sort());
    // Task 04.6 additive map: owner-scoped recorded positions only; never an address, label or event metadata.
    expect(response.body.data.map).toEqual({ origin: { latitude: 33.9, longitude: 35.5, label: 'ElectroHub demo hub' }, destination: null,
      path: [[33.8938, 35.5018]], pathKind: 'RECORDED' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.location).toEqual({ latitude: 33.8938, longitude: 35.5018, label: 'Hub', updatedAt: expect.any(String), source: 'MANUAL' });
    for (const entry of response.body.data.timeline) expect(Object.keys(entry).every(key => ['id', 'type', 'occurredAt', 'status', 'estimatedAt'].includes(key))).toBe(true);
  });
});
