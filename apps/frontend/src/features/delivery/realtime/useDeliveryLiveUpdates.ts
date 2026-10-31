import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { useAuth } from '@/features/auth/context/AuthContext';
import { queryKeys } from '@/lib/query';
import { formatStamp, stageOf } from '../presentation';
import type { CustomerDeliverySnapshot, DeliveryRevokedEvent, DeliveryUpdatedEvent } from '../types';
import { PAUSE_AFTER_MS, RESYNCED_FOR_MS } from './constants';
import { acquireDeliverySocket, releaseDeliverySocket } from './deliverySocket';
import { reconcileDeliveryEvent } from './reconcile';

/**
 * Task 04.7 live tracking for one order (architecture §8.3, handoff §9.3). React Query stays the only store: socket events merge into the
 * cached snapshot only when they are exactly the next revision; anything else refetches REST. Every (re)subscribe refetches REST too, so a
 * missed event is never a missed state. Events are dropped unless they match this order and the signed-in user at the time they arrive.
 */
export type LiveState = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'paused' | 'resynced' | 'stopped';
export type LiveNotice = { id: number; title: string; tone: 'info' | 'success' };
type Ack = { ok: true; revision: number } | { ok: false; code: string };
type Snapshot = { data: CustomerDeliverySnapshot };

const ACTIVE = new Set(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY']);

/** What changed for the customer, in words: status and ETA only; location ticks are never announced. */
export function describeChange(previous: CustomerDeliverySnapshot, next: CustomerDeliverySnapshot): LiveNotice[] {
  const notices: LiveNotice[] = [];
  if (previous.status !== next.status) {
    notices.push(next.status === 'DELIVERED' ? { id: 0, title: 'Your order was delivered.', tone: 'success' }
      : { id: 0, title: `Order status: ${stageOf(next.status).label}.`, tone: 'info' });
  }
  if (next.status !== 'DELIVERED' && previous.eta.estimatedAt !== next.eta.estimatedAt) {
    notices.push({ id: 0, tone: 'info', title: next.eta.estimatedAt ? `Estimated arrival updated: around ${formatStamp(next.eta.estimatedAt)}.`
      : 'Estimated arrival cleared. We will show a new estimate when it is available.' });
  }
  return notices;
}

export function useDeliveryLiveUpdates(orderReference: string, snapshot: CustomerDeliverySnapshot | undefined) {
  const client = useQueryClient();
  const { user, isSessionVerified, isLoggingOut } = useAuth();
  const userId = user?.id ?? '';
  const [state, setState] = useState<LiveState>('off');
  const [announcement, setAnnouncement] = useState('');
  const [notices, setNotices] = useState<LiveNotice[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const resyncRef = useRef<() => void>(() => undefined);
  const userRef = useRef(userId);
  userRef.current = userId;
  const noticeId = useRef(0);

  const terminal = snapshot?.status === 'DELIVERED';
  const eligible = Boolean(snapshot && userId && isSessionVerified && !isLoggingOut && ACTIVE.has(snapshot.status)
    && (snapshot.availability === 'AVAILABLE' || snapshot.availability === 'NOT_STARTED'));
  const key = queryKeys.delivery.snapshot(userId, orderReference);

  const announce = useCallback((text: string) => setAnnouncement(text), []);
  const pushNotices = useCallback((items: LiveNotice[]) => {
    if (!items.length) return;
    announce(items.map(item => item.title).join(' '));
    setNotices(previous => [...previous, ...items.map(item => ({ ...item, id: ++noticeId.current }))].slice(-3));
  }, [announce]);

  useEffect(() => {
    if (!eligible) { setState(terminal ? 'stopped' : 'off'); return; }
    const owner = userId;
    const queryKey = queryKeys.delivery.snapshot(owner, orderReference);
    const socket = acquireDeliverySocket(owner);
    socketRef.current = socket;
    let disposed = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    let interrupted = false;
    let paused = false;
    const refetch = () => client.invalidateQueries({ queryKey, exact: true });

    // A subscription ack is not proof the REST snapshot is current. Live/resynced is reported only after a REST read actually succeeds and
    // is at least the acknowledged revision. A newer attempt (or unmount / owner change) supersedes an older one; failure stays truthful
    // and leaves the 60 s polling fallback and "Refresh now" in charge. There is no automatic retry loop.
    let attempt = 0;
    let acked: number | null = null;
    const settle = (ackRevision: number, succeeded: boolean) => {
      const current = client.getQueryData<Snapshot>(queryKey)?.data;
      // Only a connected socket with a live subscription can be reported as synchronized.
      if (!socket.connected || acked === null) return;
      if (!succeeded || client.getQueryState(queryKey)?.error || !current || current.revision < ackRevision) return;
      if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
      if (interrupted) {
        if (paused) announce('Live updates restored. Tracking is up to date.');
        interrupted = false; paused = false;
        setState('resynced');
        if (resyncTimer) clearTimeout(resyncTimer);
        resyncTimer = setTimeout(() => { if (!disposed) setState('connected'); }, RESYNCED_FOR_MS);
      } else setState('connected');
    };
    const confirm = async (ackRevision: number) => {
      const mine = ++attempt;
      let succeeded = true;
      try { await client.refetchQueries({ queryKey, exact: true }, { throwOnError: true }); } catch { succeeded = false; }
      if (disposed || mine !== attempt || userRef.current !== owner) return;
      settle(ackRevision, succeeded);
    };
    // "Refresh now" has just completed its own REST read: it can complete a pending reconciliation without a second request.
    resyncRef.current = () => { if (acked !== null && socket.connected) settle(acked, true); };

    const subscribe = () => {
      acked = null;
      // Each (re)subscribe starts a new generation: an ack or REST completion from an earlier connection is discarded.
      const generation = ++attempt;
      socket.timeout(5_000).emitWithAck('delivery:subscribe', { orderReference }).then((ack: Ack) => {
        if (disposed || generation !== attempt) return;
        if (!ack.ok) {
          // NOT_FOUND / INVALID: REST decides what the page shows. Limits: stay on the polling fallback.
          void refetch();
          setState('paused');
          return;
        }
        acked = ack.revision;
        void confirm(ack.revision);
      }).catch(() => { if (!disposed) onDrop(); });
    };
    const onDrop = () => {
      if (disposed) return;
      // A disconnect invalidates any pending acknowledgment or REST reconciliation.
      attempt++;
      acked = null;
      interrupted = true;
      setState(current => current === 'paused' ? 'paused' : 'reconnecting');
      if (!pauseTimer && !paused) pauseTimer = setTimeout(() => {
        pauseTimer = null;
        if (disposed || socket.connected) return;
        paused = true;
        setState('paused');
        announce('Live updates paused. Showing the last saved status.');
      }, PAUSE_AFTER_MS);
    };
    const onUpdated = (event: DeliveryUpdatedEvent) => {
      if (disposed || event?.orderReference !== orderReference || userRef.current !== owner) return;
      const cached = client.getQueryData<Snapshot>(queryKey)?.data;
      // A REST read already in flight may have started before this commit: restart it rather than racing it.
      if (client.isFetching({ queryKey, exact: true })) { void refetch(); return; }
      const result = reconcileDeliveryEvent(cached, event);
      if (result.kind === 'ignore') return;
      if (result.kind === 'refetch' || !cached) { void refetch(); return; }
      client.setQueryData<Snapshot>(queryKey, { data: result.next });
      pushNotices(describeChange(cached, result.next));
    };
    const onRevoked = (event: DeliveryRevokedEvent) => {
      if (disposed || event?.orderReference !== orderReference || userRef.current !== owner) return;
      void refetch();
      socket.emit('delivery:unsubscribe', { orderReference });
    };

    socket.on('connect', subscribe);
    socket.on('disconnect', onDrop);
    socket.on('connect_error', onDrop);
    socket.on('delivery:updated', onUpdated);
    socket.on('delivery:revoked', onRevoked);
    if (socket.connected) subscribe();
    else onDrop();
    // The first connection attempt is not an interruption the customer needs to hear about.
    interrupted = false;
    setState('connecting');

    return () => {
      disposed = true;
      if (pauseTimer) clearTimeout(pauseTimer);
      if (resyncTimer) clearTimeout(resyncTimer);
      socket.off('connect', subscribe);
      socket.off('disconnect', onDrop);
      socket.off('connect_error', onDrop);
      socket.off('delivery:updated', onUpdated);
      socket.off('delivery:revoked', onRevoked);
      if (socket.connected) socket.emit('delivery:unsubscribe', { orderReference });
      socketRef.current = null;
      resyncRef.current = () => undefined;
      attempt++;
      releaseDeliverySocket(socket);
    };
  }, [client, eligible, terminal, userId, orderReference, announce, pushNotices]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      if (socketRef.current && !socketRef.current.connected) socketRef.current.connect();
      await client.refetchQueries({ queryKey: key, exact: true });
      resyncRef.current();
    } finally { setRefreshing(false); }
  }, [client, key]);

  const dismissNotice = useCallback((id: number) => setNotices(previous => previous.filter(notice => notice.id !== id)), []);
  return { state, live: state === 'connected' || state === 'resynced', announcement, notices, dismissNotice, refreshNow, refreshing };
}
