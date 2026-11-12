/**
 * Task 04.7 real-time publication against the real Express app, a real Socket.IO server and a DISPOSABLE PostgreSQL
 * (scripts/delivery-pg.cjs only). Covers T7-03 (room-scoped publish after commit), T7-04 (rollback emits nothing), no-op silence,
 * T7-13 (simulation is ADMIN only), the simulation tick path (SIMULATION source, SIMULATED location, no order/payment change) and AC3.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import request from 'supertest';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAccessToken } from '../utils/jwt.js';
import { deliveryFixtures } from '../services/__tests__/helpers/delivery-fixtures.js';

const enabled = process.env.DELIVERY_PG_RUN === '1';
const fixtures = deliveryFixtures('realtime');
const bearer = (user: { id: string; sessionId?: string }, role: string) =>
  `Bearer ${generateAccessToken({ userId: user.id, role, sessionId: user.sessionId })}`;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Event = { v: number; orderReference: string; revision: number; changed: string[]; source: string; snapshot: Record<string, unknown>;
  timelineEntry: unknown; timelineEntries: unknown[] };

function keys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => keys(item, found));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { found.add(key); keys(child, found); }
  return found;
}

describe.skipIf(!enabled).sequential('Task 04.7 real-time delivery on real PostgreSQL and Socket.IO', () => {
  let prisma: typeof import('../lib/prisma.js').prisma;
  let simulation: typeof import('../services/delivery-simulation/delivery-simulation.runner.js').deliverySimulation;
  let http: HttpServer; let close: () => Promise<void>; let base: string;
  let admin: { id: string }; let owner: { id: string }; let other: { id: string };
  let order: Awaited<ReturnType<typeof fixtures.order>>; let otherOrder: typeof order;
  const sockets: ClientSocket[] = [];
  const ownerEvents: Event[] = []; const otherEvents: Event[] = [];

  async function socketFor(user: { id: string }, reference: string, sink: Event[]) {
    const socket = connect(`${base}/delivery`, { auth: { token: generateAccessToken({ userId: user.id, role: 'CUSTOMER' }) }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
    socket.on('delivery:updated', event => sink.push(event));
    return { socket, ack: await socket.timeout(5000).emitWithAck('delivery:subscribe', { orderReference: reference }) };
  }
  const patch = (body: object) => request(http).patch(`/api/admin/orders/${order.reference}/delivery`).set('Authorization', bearer(admin, 'ADMIN')).send(body);

  beforeAll(async () => {
    const app = (await import('../app.js') as unknown as { default: Express }).default;
    ({ prisma } = await import('../lib/prisma.js'));
    const { attachDeliveryGateway } = await import('./delivery.gateway.js');
    const { DeliveryPublisher } = await import('./delivery.publisher.js');
    ({ deliverySimulation: simulation } = await import('../services/delivery-simulation/delivery-simulation.runner.js'));
    http = createServer(app);
    const gateway = attachDeliveryGateway(http, { corsOrigin: 'http://localhost:5173' });
    DeliveryPublisher.attach(gateway);
    close = gateway.close;
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    admin = await fixtures.user('ADMIN', 'admin');
    owner = await fixtures.user('CUSTOMER', 'owner');
    other = await fixtures.user('CUSTOMER', 'other');
    order = await fixtures.order(owner.id, 'CONFIRMED', 'SUCCEEDED');
    otherOrder = await fixtures.order(other.id, 'CONFIRMED', 'SUCCEEDED');
  });
  afterAll(async () => {
    simulation?.stopAll();
    for (const socket of sockets) socket.disconnect();
    await close?.();
    expect(await fixtures.cleanup()).toBe(0);
    await prisma.$disconnect();
  });

  it('T7-01/T7-02 on real rows: owner subscribe acks revision 0 before tracking; the other customer gets NOT_FOUND', async () => {
    expect((await socketFor(owner, order.reference, ownerEvents)).ack).toEqual({ ok: true, revision: 0 });
    const intruder = await socketFor(other, order.reference, otherEvents);
    expect(intruder.ack).toEqual({ ok: false, code: 'NOT_FOUND' });
    // The other customer keeps a legitimate subscription to their own order for the isolation checks below.
    expect((await intruder.socket.timeout(5000).emitWithAck('delivery:subscribe', { orderReference: otherOrder.reference }))).toEqual({ ok: true, revision: 0 });
  });

  it('T7-03 start and PATCH publish after commit with the persisted revision and a customer-safe projection', async () => {
    expect((await request(http).post(`/api/admin/orders/${order.reference}/delivery`).set('Authorization', bearer(admin, 'ADMIN')).send({})).status).toBe(201);
    const response = await patch({ expectedRevision: 1, status: 'PREPARING', estimatedAt: new Date(Date.now() + 3_600_000).toISOString(), note: 'gate code 1234' });
    expect(response.status).toBe(200);
    await wait(300);
    expect(ownerEvents.map(event => [event.revision, event.changed])).toEqual([[1, ['tracking']], [2, ['status', 'eta']]]);
    const event = ownerEvents[1];
    expect(event).toMatchObject({ v: 1, orderReference: order.reference, source: 'ADMIN', snapshot: { revision: 2, status: 'PREPARING', availability: 'AVAILABLE' } });
    expect((event.timelineEntries as { type: string }[]).map(entry => entry.type)).toEqual(['STATUS_CHANGED', 'ETA_UPDATED']);
    const forbidden = ['note', 'actorEmail', 'actorUserId', 'orderId', 'customer', 'history', 'path', 'userId', 'email', 'shippingPhone'];
    expect([...keys(event)].filter(key => forbidden.includes(key))).toEqual([]);
    expect(JSON.stringify(event)).not.toContain('gate code');
    expect(otherEvents).toEqual([]);
  });

  it('a no-op PATCH (meta.changed=false) emits nothing', async () => {
    const before = ownerEvents.length;
    const response = await patch({ expectedRevision: 2, status: 'PREPARING' });
    expect([response.status, response.body.meta.changed]).toEqual([200, false]);
    await wait(300);
    expect(ownerEvents.length).toBe(before);
  });

  it('T7-04 a forced transaction failure returns 500, rolls back and emits nothing', async () => {
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    await prisma.$executeRaw`INSERT INTO delivery_events (id, "deliveryId", revision, type, source) VALUES (gen_random_uuid(), ${delivery.id}::uuid, 3, 'ETA_CLEARED', 'SYSTEM')`;
    const before = ownerEvents.length;
    expect((await patch({ expectedRevision: 2, status: 'OUT_FOR_DELIVERY' })).status).toBe(500);
    await wait(400);
    expect(ownerEvents.length).toBe(before);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PREPARING');
    await prisma.deliveryEvent.deleteMany({ where: { deliveryId: delivery.id, revision: 3, source: 'SYSTEM' } });
  });

  it('T7-13 simulation endpoints are ADMIN only and refused before OUT_FOR_DELIVERY', async () => {
    const path = `/api/admin/orders/${order.reference}/delivery/simulation`;
    const customer = bearer(owner, 'CUSTOMER');
    expect((await request(http).post(path).set('Authorization', customer).send({ routeId: 'demo-hub-north' })).status).toBe(403);
    expect((await request(http).delete(path).set('Authorization', customer)).status).toBe(403);
    expect((await request(http).get(path).set('Authorization', customer)).status).toBe(403);
    const early = await request(http).post(path).set('Authorization', bearer(admin, 'ADMIN')).send({ routeId: 'demo-hub-north' });
    expect([early.status, early.body.error.code]).toEqual([409, 'DELIVERY_LOCATION_NOT_ALLOWED']);
    const unknown = await request(http).post(path).set('Authorization', bearer(admin, 'ADMIN')).send({ routeId: 'not-approved' });
    expect(unknown.status).toBe(400);
    const smuggled = await request(http).post(path).set('Authorization', bearer(admin, 'ADMIN')).send({ routeId: 'demo-hub-north', tickMs: 10 });
    expect(smuggled.status).toBe(400);
  });

  it('simulation ticks go through the DeliveryService transaction as SIMULATION; order and payment never change; AC3 isolation holds', async () => {
    expect((await patch({ expectedRevision: 2, status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    const path = `/api/admin/orders/${order.reference}/delivery/simulation`;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const started = await request(http).post(path).set('Authorization', bearer(admin, 'ADMIN')).send({ routeId: 'demo-hub-north' });
    expect([started.status, started.body.data.running, started.body.data.tickSeconds]).toEqual([201, true, 5]);
    const again = await request(http).post(path).set('Authorization', bearer(admin, 'ADMIN')).send({ routeId: 'demo-hub-north' });
    expect([again.status, again.body.error.code]).toEqual([409, 'DELIVERY_SIMULATION_RUNNING']);
    for (let i = 0; i < 4; i++) expect(await simulation.tick(order.reference)).toBe(true);
    const stopped = await request(http).delete(path).set('Authorization', bearer(admin, 'ADMIN'));
    expect([stopped.status, stopped.body.data.running]).toEqual([200, false]);
    await wait(400);

    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id }, include: { events: { orderBy: { revision: 'asc' } } } });
    expect(delivery).toMatchObject({ isSimulated: true, locationSource: 'SIMULATED', status: 'OUT_FOR_DELIVERY' });
    const simulated = delivery.events.filter(event => event.source === 'SIMULATION');
    expect(simulated[0].type).toBe('SIMULATION_STARTED');
    expect(simulated.at(-1)!.type).toBe('SIMULATION_STOPPED');
    // Ticks only ever write a location, one revision per tick.
    expect(simulated.slice(1, -1).every(event => event.type === 'LOCATION_UPDATED' && event.changes.join() === 'LOCATION')).toBe(true);
    expect(simulated.length).toBeGreaterThanOrEqual(6);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).toEqual(payment);

    const simulationEvents = ownerEvents.filter(event => event.source === 'SIMULATION');
    expect(simulationEvents.length).toBeGreaterThanOrEqual(6);
    expect(simulationEvents.some(event => event.changed.includes('location') && (event.snapshot.location as { source: string }).source === 'SIMULATED')).toBe(true);
    expect(simulationEvents.every(event => event.snapshot.isSimulated === true)).toBe(true);
    const revisions = ownerEvents.map(event => event.revision);
    expect([...revisions].sort((a, b) => a - b)).toEqual(revisions);
    expect(otherEvents).toEqual([]);
    const view = await request(http).get(`/api/orders/${order.reference}/delivery`).set('Authorization', bearer(owner, 'CUSTOMER'));
    expect(view.body.data).toMatchObject({ isSimulated: true, revision: delivery.revision, map: { pathKind: 'SIMULATED_FIXTURE' } });
  }, 30000);

  it('boot recovery records a SYSTEM stop for an orphaned simulation', async () => {
    const path = `/api/admin/orders/${order.reference}/delivery/simulation`;
    expect((await request(http).post(path).set('Authorization', bearer(admin, 'ADMIN')).send({ routeId: 'demo-hub-coastal' })).status).toBe(201);
    simulation.stopAll();
    expect(await simulation.recoverOrphans()).toBe(1);
    const last = await prisma.deliveryEvent.findFirstOrThrow({ where: { delivery: { orderId: order.id } }, orderBy: { revision: 'desc' } });
    expect([last.type, last.source, last.actorUserId]).toEqual(['SIMULATION_STOPPED', 'SYSTEM', null]);
    expect(await simulation.recoverOrphans()).toBe(0);
  });
  it('out-for-delivery hint reaches only its customer; unchanged retries emit nothing and history survives reconnect', async () => {
    const owned = await fixtures.order(owner.id, 'PREPARING', 'SUCCEEDED');
    const ownerSocket = (await socketFor(owner, owned.reference, [])).socket;
    const otherSocket = (await socketFor(other, otherOrder.reference, [])).socket;
    const received: unknown[] = []; const leaked: unknown[] = [];
    ownerSocket.on('notification:created', event => received.push(event));
    otherSocket.on('notification:created', event => leaked.push(event));
    expect((await request(http).post(`/api/admin/orders/${owned.reference}/delivery`).set('Authorization', bearer(admin, 'ADMIN')).send({})).status).toBe(201);
    const endpoint = `/api/admin/orders/${owned.reference}/delivery`;
    expect((await request(http).patch(endpoint).set('Authorization', bearer(admin, 'ADMIN')).send({ expectedRevision: 1, status: 'SHIPPED' })).status).toBe(400);
    await wait(100); expect(received).toEqual([]); expect(leaked).toEqual([]);
    expect(await prisma.customerNotification.count({ where: { orderId: owned.id } })).toBe(0);
    expect((await request(http).patch(endpoint).set('Authorization', bearer(admin, 'ADMIN')).send({ expectedRevision: 1, status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    await wait(300);
    expect(received).toEqual([{ v: 1, id: expect.any(String), type: 'ORDER_OUT_FOR_DELIVERY', orderReference: owned.reference, occurredAt: expect.any(String) }]);
    expect(leaked).toEqual([]);
    expect((await request(http).patch(endpoint).set('Authorization', bearer(admin, 'ADMIN')).send({ expectedRevision: 2, status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    await wait(300); expect(received).toHaveLength(1);
    ownerSocket.disconnect();
    const history = await request(http).get('/api/notifications').set('Authorization', bearer(owner, 'CUSTOMER'));
    expect(history.body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ orderReference: owned.reference, readAt: null })]));
    const id = history.body.data.items.find((item: { orderReference: string }) => item.orderReference === owned.reference).id;
    expect((await request(http).patch(`/api/notifications/${id}/read`).set('Authorization', bearer(other, 'CUSTOMER'))).status).toBe(404);
    expect((await request(http).patch(`/api/notifications/${id}/read`).set('Authorization', bearer(owner, 'CUSTOMER'))).status).toBe(204);
    const refreshed = await request(http).get('/api/notifications').set('Authorization', bearer(owner, 'CUSTOMER'));
    expect(refreshed.body.data.items.find((item: { id: string }) => item.id === id).readAt).not.toBeNull();
  });

});
