/**
 * Task 04.7 socket integration (S): a real Socket.IO server on an ephemeral HTTP port and real `socket.io-client` connections. Identity and
 * order ownership come from injected lookups here; the disposable-PostgreSQL suite covers the same paths against real rows (T7-03/T7-04).
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
const projection = vi.hoisted(() => ({ getRealtimeProjection: vi.fn() }));
vi.mock('../services/delivery.service.js', () => ({ DeliveryService: class { getRealtimeProjection = projection.getRealtimeProjection; } }));

import { attachDeliveryGateway, orderRoom } from './delivery.gateway.js';
import { DeliveryPublisher } from './delivery.publisher.js';
import { realtimeMetrics } from './realtime-metrics.js';
import { generateAccessToken, JWT_SECRET } from '../utils/jwt.js';
import { assertSimulationBootConfig, simulationAvailability, SIMULATION_ROUTES, SIMULATION_MAX_POINTS } from '../services/delivery-simulation/simulation.config.js';

type Gateway = ReturnType<typeof attachDeliveryGateway>;
const customerA = randomUUID(), customerB = randomUUID();
const orderA = randomUUID(), orderB = randomUUID();
const ref = (id: string) => `ORD-${id.toUpperCase()}`;
const owners = new Map([[orderA, customerA], [orderB, customerB]]);

let http: HttpServer; let gateway: Gateway; let url: string; let active = new Map<string, string>();
/** Task 05.2: live MFA-assured administrator session families (familyId → userId). */
const adminSessions = new Map<string, string>();
const clients: ClientSocket[] = [];

async function start(limits = {}) {
  http = createServer();
  gateway = attachDeliveryGateway(http, { corsOrigin: 'http://localhost:5173', limits,
    lookup: async userId => active.has(userId) ? { role: active.get(userId)! } : null,
    adminSession: async (familyId, userId) => adminSessions.get(familyId) === userId,
    resolveOrder: async (identity, reference) => {
      const id = [...owners.keys()].find(orderId => ref(orderId) === reference);
      return id && (identity.role === 'ADMIN' || owners.get(id) === identity.userId) ? { orderId: id, revision: 3 } : null;
    } });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/delivery`;
}

function client(token: string | undefined, options: { reconnection?: boolean } = {}) {
  const socket = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: options.reconnection ?? false, forceNew: true });
  clients.push(socket);
  return socket;
}
const token = (userId: string, role = 'CUSTOMER', sessionId?: string) => generateAccessToken(sessionId ? { userId, role, sessionId } : { userId, role });
const connected = (socket: ClientSocket) => new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
const refused = (socket: ClientSocket) => new Promise<{ code?: string }>(resolve => socket.once('connect_error', error => resolve((error as Error & { data?: { code?: string } }).data ?? {})));
const subscribe = (socket: ClientSocket, orderReference: unknown) => socket.timeout(2000).emitWithAck('delivery:subscribe', { orderReference });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(async () => {
  active = new Map([[customerA, 'CUSTOMER'], [customerB, 'CUSTOMER']]);
  realtimeMetrics.reset();
  projection.getRealtimeProjection.mockReset();
  await start();
  DeliveryPublisher.attach(gateway);
});
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  DeliveryPublisher.attach(null);
  await gateway.close();
});

describe('Task 04.7 /delivery gateway (real Socket.IO server and client)', () => {
  it('refuses handshakes without a valid token or for an inactive account', async () => {
    expect(await refused(client(undefined))).toEqual({ code: 'UNAUTHENTICATED' });
    expect(await refused(client('not-a-jwt'))).toEqual({ code: 'UNAUTHENTICATED' });
    const forged = jwt.sign({ userId: customerA, role: 'CUSTOMER' }, 'wrong-secret', { algorithm: 'HS256', expiresIn: '15m' });
    expect(await refused(client(forged))).toEqual({ code: 'UNAUTHENTICATED' });
    active.delete(customerA);
    expect(await refused(client(token(customerA)))).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('T7-01 owner subscribe is acknowledged with the persisted revision', async () => {
    const socket = client(token(customerA));
    await connected(socket);
    expect(await subscribe(socket, ref(orderA))).toEqual({ ok: true, revision: 3 });
    expect(gateway.namespace.adapter.rooms.get(orderRoom(orderA))?.size).toBe(1);
  });

  it('T7-02 another customer\'s order and an unknown order are the same NOT_FOUND, and nothing is joined', async () => {
    const socket = client(token(customerA));
    await connected(socket);
    const foreign = await subscribe(socket, ref(orderB));
    const unknown = await subscribe(socket, ref(randomUUID()));
    expect(foreign).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(unknown).toEqual(foreign);
    expect(gateway.namespace.adapter.rooms.get(orderRoom(orderB))).toBeUndefined();
    expect(await subscribe(socket, 'delivery:order:' + orderB)).toEqual({ ok: false, code: 'INVALID' });
    expect(await subscribe(socket, { $ne: null })).toEqual({ ok: false, code: 'INVALID' });
  });

  it('T7-03 / AC3 delivery:updated reaches only the order room; two customers never see each other\'s events', async () => {
    const a = client(token(customerA)); const b = client(token(customerB));
    await Promise.all([connected(a), connected(b)]);
    await subscribe(a, ref(orderA)); await subscribe(b, ref(orderB));
    const seenA: { orderReference: string; revision: number }[] = []; const seenB: typeof seenA = [];
    a.on('delivery:updated', event => seenA.push(event)); b.on('delivery:updated', event => seenB.push(event));
    for (let revision = 4; revision <= 8; revision++) {
      const orderId = revision % 2 ? orderB : orderA;
      projection.getRealtimeProjection.mockResolvedValueOnce({ orderId, orderReference: ref(orderId), revision, occurredAt: new Date().toISOString(),
        snapshot: { orderReference: ref(orderId), revision }, timelineEntries: [], source: 'SIMULATION' });
      await DeliveryPublisher.afterCommit(orderId, ['location']);
    }
    await wait(150);
    expect(seenA.map(event => [event.orderReference, event.revision])).toEqual([[ref(orderA), 4], [ref(orderA), 6], [ref(orderA), 8]]);
    expect(seenB.map(event => [event.orderReference, event.revision])).toEqual([[ref(orderB), 5], [ref(orderB), 7]]);
    expect(seenA[0]).toMatchObject({ v: 1, changed: ['location'], source: 'SIMULATION', timelineEntry: null });
  });

  it('publish failures are counted and logged, never thrown; no-op changes and a detached gateway publish nothing', async () => {
    projection.getRealtimeProjection.mockRejectedValueOnce(new Error('db down'));
    await expect(DeliveryPublisher.afterCommit(orderA, ['status'])).resolves.toBeUndefined();
    expect(realtimeMetrics.snapshot().counters.publish_failed).toBe(1);
    await DeliveryPublisher.afterCommit(orderA, []);
    DeliveryPublisher.attach(null);
    await DeliveryPublisher.afterCommit(orderA, ['status']);
    expect(projection.getRealtimeProjection).toHaveBeenCalledTimes(1);
  });

  it('T7-05 logout/deletion disconnects every socket of that user only, through the user room', async () => {
    const a1 = client(token(customerA)); const a2 = client(token(customerA)); const b = client(token(customerB));
    await Promise.all([connected(a1), connected(a2), connected(b)]);
    const reasons: string[] = [];
    a1.on('disconnect', reason => reasons.push(reason)); a2.on('disconnect', reason => reasons.push(reason));
    DeliveryPublisher.disconnectUser(customerA, 'LOGOUT');
    await wait(150);
    expect(reasons).toEqual(['io server disconnect', 'io server disconnect']);
    expect(b.connected).toBe(true);
  });

  it('a deactivated account is dropped on its next subscribe (role and isActive re-evaluated every time)', async () => {
    const socket = client(token(customerA));
    await connected(socket);
    active.delete(customerA);
    const closed = new Promise(resolve => socket.once('disconnect', resolve));
    expect(await subscribe(socket, ref(orderA))).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    await closed;
  });

  it('Task 05.2: an ADMIN token without a live MFA-assured session is refused at the handshake', async () => {
    const adminId = randomUUID();
    active.set(adminId, 'ADMIN');
    expect(await refused(client(token(adminId, 'ADMIN')))).toEqual({ code: 'UNAUTHENTICATED' });
    expect(await refused(client(token(adminId, 'ADMIN', randomUUID())))).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('ADMIN may watch any order; a demoted admin loses that on the next subscribe', async () => {
    const adminId = randomUUID();
    const sessionId = randomUUID();
    active.set(adminId, 'ADMIN');
    adminSessions.set(sessionId, adminId);
    const socket = client(token(adminId, 'ADMIN', sessionId));
    await connected(socket);
    expect(await subscribe(socket, ref(orderB))).toEqual({ ok: true, revision: 3 });
    active.set(adminId, 'CUSTOMER');
    expect(await subscribe(socket, ref(orderA))).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('refuses another subscription and disconnects an ADMIN socket after its session is revoked', async () => {
    const adminId = randomUUID(), sessionId = randomUUID();
    active.set(adminId, 'ADMIN');
    adminSessions.set(sessionId, adminId);
    const socket = client(token(adminId, 'ADMIN', sessionId));
    await connected(socket);
    expect(await subscribe(socket, ref(orderB))).toEqual({ ok: true, revision: 3 });
    adminSessions.delete(sessionId);
    const closed = new Promise(resolve => socket.once('disconnect', resolve));
    expect(await subscribe(socket, ref(orderA))).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    await closed;
    expect(gateway.namespace.adapter.rooms.get(orderRoom(orderB))).toBeUndefined();
  });

  it('T7-06 server side: a replaced socket keeps no rooms, so events for the old user cannot reach it', async () => {
    const a = client(token(customerA));
    await connected(a);
    await subscribe(a, ref(orderA));
    a.disconnect();
    const b = client(token(customerB));
    await connected(b);
    const seen: unknown[] = [];
    b.on('delivery:updated', event => seen.push(event));
    projection.getRealtimeProjection.mockResolvedValueOnce({ orderId: orderA, orderReference: ref(orderA), revision: 9, occurredAt: '', snapshot: {}, timelineEntries: [], source: 'ADMIN' });
    await DeliveryPublisher.afterCommit(orderA, ['eta']);
    await wait(100);
    expect(seen).toEqual([]);
    expect(gateway.namespace.adapter.rooms.get(orderRoom(orderA))).toBeUndefined();
  });

  it('T7-10 a restarted server: clients reconnect and re-authenticate on their own', async () => {
    const socket = client(token(customerA), { reconnection: true });
    await connected(socket);
    const port = (http.address() as AddressInfo).port;
    await gateway.close();
    http = createServer();
    gateway = attachDeliveryGateway(http, { corsOrigin: 'http://localhost:5173', lookup: async userId => active.has(userId) ? { role: active.get(userId)! } : null,
      resolveOrder: async () => ({ orderId: orderA, revision: 4 }) });
    const reconnected = new Promise<void>(resolve => socket.io.once('reconnect', () => resolve()));
    await new Promise<void>(resolve => http.listen(port, '127.0.0.1', resolve));
    await reconnected;
    expect(await subscribe(socket, ref(orderA))).toEqual({ ok: true, revision: 4 });
  }, 15000);

  it('T7-14 the server emits session:expired at the token exp and then disconnects', async () => {
    const short = jwt.sign({ userId: customerA, role: 'CUSTOMER' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: 2 });
    const socket = client(short);
    const expired = new Promise(resolve => socket.once('session:expired', resolve));
    const dropped = new Promise<string>(resolve => socket.once('disconnect', resolve));
    await connected(socket);
    expect(await expired).toEqual({ v: 1 });
    expect(await dropped).toBe('io server disconnect');
    expect(realtimeMetrics.snapshot().counters.session_expired).toBe(1);
  }, 10000);

  it('T7-15 the 11th connection is refused, 5 subscriptions per socket, 20 subscribes per minute', async () => {
    const sockets = Array.from({ length: 10 }, () => client(token(customerA)));
    await Promise.all(sockets.map(connected));
    expect(await refused(client(token(customerA)))).toEqual({ code: 'TOO_MANY_CONNECTIONS' });
    sockets[0].disconnect();
    await wait(100);
    const replacement = client(token(customerA));
    await connected(replacement);

    // Five distinct rooms fill the per-socket cap; the sixth is refused.
    const extra = Array.from({ length: 6 }, () => randomUUID());
    extra.forEach(id => owners.set(id, customerA));
    const acks = [];
    for (const id of extra) acks.push(await subscribe(replacement, ref(id)));
    expect(acks.slice(0, 5).every(ack => ack.ok)).toBe(true);
    expect(acks[5]).toEqual({ ok: false, code: 'LIMIT_REACHED' });

    const flood = sockets[1];
    const results = [];
    for (let i = 0; i < 21; i++) results.push(await subscribe(flood, ref(orderA)));
    expect(results.slice(0, 20).every(ack => ack.ok)).toBe(true);
    expect(results[20]).toEqual({ ok: false, code: 'RATE_LIMITED' });
    extra.forEach(id => owners.delete(id));
  });

  it('rejects payloads above the 4 KB buffer by closing the socket', async () => {
    const socket = client(token(customerA));
    await connected(socket);
    const closed = new Promise<string>(resolve => socket.once('disconnect', resolve));
    socket.emit('delivery:subscribe', { orderReference: 'x'.repeat(8 * 1024) });
    expect(await closed).toBe('transport close');
  });
});

describe('Task 04.7 simulation guards', () => {
  it('T7-12 production with the flag refuses to boot; enablement needs the flag, non-production and a disposable database', () => {
    expect(() => assertSimulationBootConfig({ NODE_ENV: 'production', DELIVERY_SIMULATION_ENABLED: 'true' })).toThrow(/must not be set in production/);
    expect(() => assertSimulationBootConfig({ NODE_ENV: 'production' })).not.toThrow();
    const disposable = 'postgresql://postgres@127.0.0.1:5544/electrohub_disposable_qa?sslmode=require';
    expect(simulationAvailability({ NODE_ENV: 'development', DATABASE_URL: disposable })).toEqual({ enabled: false, reason: 'FLAG_OFF' });
    expect(simulationAvailability({ NODE_ENV: 'production', DELIVERY_SIMULATION_ENABLED: 'true', DATABASE_URL: disposable })).toEqual({ enabled: false, reason: 'PRODUCTION' });
    const sharedDev = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require';
    expect(simulationAvailability({ NODE_ENV: 'development', DELIVERY_SIMULATION_ENABLED: 'true', DATABASE_URL: sharedDev })).toEqual({ enabled: false, reason: 'DATABASE_NOT_DISPOSABLE' });
    expect(simulationAvailability({ NODE_ENV: 'development', DELIVERY_SIMULATION_ENABLED: 'true', DATABASE_URL: disposable })).toEqual({ enabled: true });
  });

  it('approved fixtures are fictional and within the point limit', () => {
    expect(SIMULATION_ROUTES.size).toBeGreaterThan(0);
    for (const route of SIMULATION_ROUTES.values()) {
      expect(route.fictional).toBe(true);
      expect(route.offsets.length).toBeLessThanOrEqual(SIMULATION_MAX_POINTS);
    }
  });
});
