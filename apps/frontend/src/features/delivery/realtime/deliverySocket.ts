import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshAccessToken } from '@/lib/api';

/**
 * Task 04.7 client transport (architecture §8.2). One `/delivery` socket per verified user, shared by every subscriber in the tab and torn
 * down when the user changes or the last subscriber leaves. It authenticates with the in-memory access token from `api.ts` on every
 * (re)connect. On `session:expired` or an UNAUTHENTICATED refusal it refreshes through the same single-flight REST path and reconnects; a
 * failed refresh leaves it closed (the app's session-expired flow takes over). The socket is a hint channel: callers re-read REST.
 */
type Entry = { userId: string; socket: Socket; users: number; lastRefresh: number; detach?: () => void };
let current: Entry | null = null;
const REFRESH_FLOOR_MS = 10_000;
const factory = { create: (auth: (cb: (data: object) => void) => void) => io('/delivery', { path: '/socket.io', auth, transports: ['websocket', 'polling'],
  reconnectionDelay: 1_000, reconnectionDelayMax: 10_000, randomizationFactor: 0.5 }) };

/** Test seam only. */
export function setDeliverySocketFactory(create: typeof factory.create) { factory.create = create; }

async function refreshAndReconnect(entry: Entry) {
  // Bounded: one refresh per 10 s per socket, so a server that keeps refusing cannot drive a refresh loop.
  if (Date.now() - entry.lastRefresh < REFRESH_FLOOR_MS) return;
  entry.lastRefresh = Date.now();
  let token: string | null = null;
  try { token = await refreshAccessToken(); } catch { token = null; }
  if (token && current === entry) entry.socket.connect();
}

function create(userId: string): Entry {
  const socket = factory.create(cb => cb({ token: getAccessToken() ?? '' }));
  const entry: Entry = { userId, socket, users: 0, lastRefresh: 0 };
  socket.on('session:expired', () => { void refreshAndReconnect(entry); });
  socket.on('connect_error', error => {
    if ((error as Error & { data?: { code?: string } }).data?.code === 'UNAUTHENTICATED') void refreshAndReconnect(entry);
  });
  // Server-initiated disconnects do not auto-reconnect (logout elsewhere, expiry, deactivation). A still-valid session refreshes and returns.
  socket.on('disconnect', reason => { if (reason === 'io server disconnect') void refreshAndReconnect(entry); });
  // Back online: reconnect now instead of waiting out the backoff (the hook then re-subscribes and re-reads REST).
  const online = () => { if (current === entry && !socket.connected) socket.connect(); };
  window.addEventListener('online', online);
  entry.detach = () => window.removeEventListener('online', online);
  return entry;
}

export function acquireDeliverySocket(userId: string): Socket {
  if (current && current.userId !== userId) closeDeliverySocket();
  if (!current) current = create(userId);
  current.users++;
  return current.socket;
}

export function releaseDeliverySocket(socket: Socket) {
  if (!current || current.socket !== socket) return;
  if (--current.users <= 0) closeDeliverySocket();
}

/** Logout and account switches: the old socket instance is discarded, so nothing addressed to it can land afterwards. */
export function closeDeliverySocket() {
  const entry = current;
  current = null;
  if (!entry) return;
  entry.detach?.();
  entry.socket.removeAllListeners();
  entry.socket.io.removeAllListeners();
  entry.socket.disconnect();
}
