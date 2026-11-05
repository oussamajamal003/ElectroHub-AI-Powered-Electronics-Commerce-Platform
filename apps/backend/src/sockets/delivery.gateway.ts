import type { Server as HttpServer } from 'node:http';
import { Server, type Namespace, type Socket } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { parseOrderReference } from '../services/order.service.js';
import { logSafely } from '../utils/logger.js';
import { realtimeMetrics } from './realtime-metrics.js';
import { liveAdminSession, lookupActiveUser, socketAuthMiddleware, socketError, type AdminSessionCheck, type SocketIdentity, type UserLookup } from './socket-auth.js';

/**
 * Task 04.7 `/delivery` namespace (architecture §8.1–§8.2). A hint channel, never a store: clients always re-read REST on (re)connect.
 * Room names are built here from verified identities and database UUIDs; a client can never name, guess or choose a room.
 */
export const DELIVERY_NAMESPACE = '/delivery';
export const orderRoom = (orderId: string) => `delivery:order:${orderId}`;
export const userRoom = (userId: string) => `user:${userId}`;
const REFERENCE = /^ORD-[0-9A-F-]{36}$/;

export type GatewayLimits = { connectionsPerUser: number; subscriptionsPerSocket: number; subscribesPerMinute: number };
export const DEFAULT_LIMITS: GatewayLimits = { connectionsPerUser: 10, subscriptionsPerSocket: 5, subscribesPerMinute: 20 };
export type OrderResolver = (identity: { userId: string; role: string }, reference: string) => Promise<{ orderId: string; revision: number } | null>;
type SubscribeAck = { ok: true; revision: number } | { ok: false; code: 'NOT_FOUND' | 'RATE_LIMITED' | 'INVALID' | 'LIMIT_REACHED' | 'UNAUTHENTICATED' };

/** Owner-scoped (ADMIN may watch any order). Unknown and not-yours are the same null, so existence never leaks. */
export const resolveSubscribableOrder: OrderResolver = async (identity, reference) => {
  let orderId: string;
  try { orderId = parseOrderReference(reference); } catch { return null; }
  const order = await prisma.order.findFirst({ where: { id: orderId, ...(identity.role === 'ADMIN' ? {} : { userId: identity.userId }) },
    select: { id: true, delivery: { select: { revision: true } } } });
  return order ? { orderId: order.id, revision: order.delivery?.revision ?? 0 } : null;
};

export interface DeliveryGateway { io: Server; namespace: Namespace; disconnectUser(userId: string, reason: string): void; close(): Promise<void> }

export function attachDeliveryGateway(server: HttpServer, options: { corsOrigin: string | string[]; lookup?: UserLookup; resolveOrder?: OrderResolver;
  limits?: Partial<GatewayLimits>; clock?: () => number; adminSession?: AdminSessionCheck }): DeliveryGateway {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const lookup = options.lookup ?? lookupActiveUser;
  const adminSession = options.adminSession ?? liveAdminSession;
  const resolveOrder = options.resolveOrder ?? resolveSubscribableOrder;
  const clock = options.clock ?? Date.now;
  const io = new Server(server, { path: '/socket.io', cors: { origin: options.corsOrigin, credentials: true }, transports: ['websocket', 'polling'],
    maxHttpBufferSize: 4 * 1024, pingInterval: 25_000, pingTimeout: 20_000, serveClient: false });
  // The default namespace is not used; anything connecting there is refused.
  io.of('/').use((_socket, next) => next(socketError('UNAVAILABLE')));
  const namespace = io.of(DELIVERY_NAMESPACE);
  const perUser = new Map<string, number>();

  const release = (socket: Socket) => {
    if (!socket.data.counted) return;
    socket.data.counted = false;
    const { userId } = socket.data.identity as SocketIdentity;
    const remaining = (perUser.get(userId) ?? 1) - 1;
    if (remaining > 0) perUser.set(userId, remaining); else perUser.delete(userId);
  };

  namespace.use(socketAuthMiddleware(lookup, options.adminSession));
  namespace.use((socket, next) => {
    const { userId } = socket.data.identity as SocketIdentity;
    if ((perUser.get(userId) ?? 0) >= limits.connectionsPerUser) {
      realtimeMetrics.increment('connections_refused');
      return next(socketError('TOO_MANY_CONNECTIONS'));
    }
    perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
    socket.data.counted = true;
    next();
  });

  namespace.on('connection', (socket: Socket) => {
    const identity = socket.data.identity as SocketIdentity;
    realtimeMetrics.increment('connections_accepted');
    realtimeMetrics.adjust('connected_sockets', 1);
    void socket.join(userRoom(identity.userId));
    const subscriptions = new Set<string>();
    const attempts: number[] = [];

    // Access tokens are short-lived: announce expiry, then drop the socket. The client refreshes through its REST path and reconnects.
    const expiry = setTimeout(() => {
      realtimeMetrics.increment('session_expired');
      socket.emit('session:expired', { v: 1 });
      socket.disconnect(true);
    }, Math.min(Math.max(identity.expiresAt - clock(), 0), 2_147_483_647));

    socket.on('delivery:subscribe', async (payload: unknown, ack: unknown) => {
      const reply = (result: SubscribeAck) => { if (typeof ack === 'function') ack(result); };
      const now = clock();
      while (attempts.length && attempts[0] <= now - 60_000) attempts.shift();
      if (attempts.length >= limits.subscribesPerMinute) { realtimeMetrics.increment('subscribe_rate_limited'); return reply({ ok: false, code: 'RATE_LIMITED' }); }
      attempts.push(now);
      const reference = (payload as { orderReference?: unknown } | null)?.orderReference;
      if (typeof reference !== 'string' || !REFERENCE.test(reference)) { realtimeMetrics.increment('subscribe_denied'); return reply({ ok: false, code: 'INVALID' }); }
      try {
        // Role and active state are re-evaluated on every subscribe, never trusted from the handshake.
        const user = await lookup(identity.userId);
        if (!user || (user.role === 'ADMIN' && !(identity.sessionId && await adminSession(identity.sessionId, identity.userId)))) {
          realtimeMetrics.increment('subscribe_denied'); reply({ ok: false, code: 'UNAUTHENTICATED' }); socket.disconnect(true); return;
        }
        const order = await resolveOrder({ userId: identity.userId, role: user.role }, reference);
        if (!order || !socket.connected) { realtimeMetrics.increment('subscribe_denied'); return reply({ ok: false, code: 'NOT_FOUND' }); }
        const room = orderRoom(order.orderId);
        if (!subscriptions.has(room)) {
          if (subscriptions.size >= limits.subscriptionsPerSocket) { realtimeMetrics.increment('subscribe_denied'); return reply({ ok: false, code: 'LIMIT_REACHED' }); }
          subscriptions.add(room);
          realtimeMetrics.adjust('active_subscriptions', 1);
          await socket.join(room);
        }
        realtimeMetrics.increment('subscribe_ok');
        reply({ ok: true, revision: order.revision });
      } catch {
        logSafely('warn', 'Delivery subscribe failed', { event: 'delivery.realtime.subscribe_failed' });
        reply({ ok: false, code: 'NOT_FOUND' });
      }
    });

    socket.on('delivery:unsubscribe', async (payload: unknown, ack: unknown) => {
      const reference = (payload as { orderReference?: unknown } | null)?.orderReference;
      let room: string | null = null;
      if (typeof reference === 'string' && REFERENCE.test(reference)) { try { room = orderRoom(parseOrderReference(reference)); } catch { room = null; } }
      if (room && subscriptions.delete(room)) { realtimeMetrics.adjust('active_subscriptions', -1); await socket.leave(room); }
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', () => {
      clearTimeout(expiry);
      release(socket);
      realtimeMetrics.adjust('active_subscriptions', -subscriptions.size);
      realtimeMetrics.adjust('connected_sockets', -1);
      subscriptions.clear();
    });
  });

  return {
    io, namespace,
    disconnectUser(userId, reason) {
      realtimeMetrics.increment('user_disconnects');
      logSafely('info', 'Delivery realtime sockets disconnected', { event: 'delivery.realtime.user_disconnected', reason });
      namespace.in(userRoom(userId)).disconnectSockets(true);
    },
    close: () => new Promise<void>(resolve => { void io.close(() => resolve()); }),
  };
}
