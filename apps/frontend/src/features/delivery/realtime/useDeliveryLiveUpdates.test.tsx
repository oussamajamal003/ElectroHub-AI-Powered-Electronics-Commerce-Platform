import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/context/AuthContext';
import { queryKeys } from '@/lib/query';
import type { CustomerDeliverySnapshot, DeliveryUpdatedEvent } from '../types';
import { ConnectionStatusBanner, ConnectionStatusPill } from './ConnectionStatusIndicator';
import { closeDeliverySocket, setDeliverySocketFactory } from './deliverySocket';
import { FakeDeliverySocket } from './fakeSocket';
import { reconcileDeliveryEvent } from './reconcile';
import { useDeliveryLiveUpdates } from './useDeliveryLiveUpdates';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), refreshAccessToken: vi.fn(async () => 'fresh') }));

const reference = 'ORD-7F3A21C0-9B4E-4D1A-8C55-2E0A6B1F93D4';
function snapshot(overrides: Partial<CustomerDeliverySnapshot> = {}): CustomerDeliverySnapshot {
  return { orderReference: reference, availability: 'AVAILABLE', status: 'OUT_FOR_DELIVERY', paymentState: 'PAID', revision: 5,
    trackingReference: 'EH-TRK-4K9Q2M7XPA', deliveryMethod: 'EXPRESS',
    eta: { estimatedAt: null, updatedAt: null, promisedStart: '2026-11-04T00:00:00.000Z', promisedEnd: '2026-11-06T00:00:00.000Z' },
    location: { latitude: 33.9, longitude: 35.5, label: null, updatedAt: '2026-11-04T10:42:00.000Z', source: 'SIMULATED' },
    deliveredAt: null, isSimulated: true, serverTime: '2026-11-04T10:48:00.000Z',
    timeline: [{ id: 'e1', type: 'TRACKING_STARTED', occurredAt: '2026-11-02T09:04:00.000Z', status: 'CONFIRMED' }],
    map: { origin: { latitude: 33.9, longitude: 35.5, label: 'Demo hub' }, destination: null, path: [[33.9, 35.5]], pathKind: 'SIMULATED_FIXTURE' },
    ...overrides };
}
function event(revision: number, overrides: Partial<CustomerDeliverySnapshot> = {}, extra: Partial<DeliveryUpdatedEvent> = {}): DeliveryUpdatedEvent {
  const { timeline: _timeline, map, ...fields } = snapshot({ revision, ...overrides });
  void _timeline;
  return { v: 1, orderReference: reference, revision, occurredAt: '2026-11-04T10:50:00.000Z', changed: ['location'],
    snapshot: { ...fields, map: map ? { origin: map.origin, destination: map.destination, pathKind: map.pathKind } : null },
    timelineEntry: null, timelineEntries: [], source: 'SIMULATION', ...extra };
}

describe('T7-08 reconcileDeliveryEvent', () => {
  it('ignores duplicates and older revisions, merges exactly the next one, refetches on a gap or a missing cache', () => {
    const cached = snapshot();
    expect(reconcileDeliveryEvent(cached, event(5))).toEqual({ kind: 'ignore' });
    expect(reconcileDeliveryEvent(cached, event(3))).toEqual({ kind: 'ignore' });
    expect(reconcileDeliveryEvent(cached, event(7))).toEqual({ kind: 'refetch' });
    expect(reconcileDeliveryEvent(undefined, event(6))).toEqual({ kind: 'refetch' });
    expect(reconcileDeliveryEvent(cached, { ...event(6), orderReference: 'ORD-00000000-0000-4000-8000-000000000000' })).toEqual({ kind: 'refetch' });
    const merged = reconcileDeliveryEvent(cached, event(6, { location: { latitude: 33.91, longitude: 35.51, label: null, updatedAt: '2026-11-04T10:50:00.000Z', source: 'SIMULATED' } }));
    expect(merged.kind).toBe('merge');
    if (merged.kind !== 'merge') return;
    expect(merged.next.revision).toBe(6);
    expect(merged.next.map?.path).toEqual([[33.9, 35.5], [33.91, 35.51]]);
    expect(merged.next.timeline).toEqual(cached.timeline);
  });

  it('prepends status and ETA entries once, and clears the path when the live location ends', () => {
    const entries = [{ id: 'e6:status', type: 'STATUS_CHANGED' as const, occurredAt: '2026-11-04T11:00:00.000Z', status: 'DELIVERED' as const }];
    const merged = reconcileDeliveryEvent(snapshot(), event(6, { status: 'DELIVERED', location: null }, { changed: ['status'], timelineEntries: entries, timelineEntry: entries[0] }));
    if (merged.kind !== 'merge') throw new Error('expected merge');
    expect(merged.next.timeline.map(entry => entry.id)).toEqual(['e6:status', 'e1']);
    expect(merged.next.map?.path).toEqual([]);
  });
});

describe('useDeliveryLiveUpdates with a fake socket', () => {
  let sockets: FakeDeliverySocket[];
  let client: QueryClient;
  const key = (userId: string) => queryKeys.delivery.snapshot(userId, reference);
  const signIn = (id: string) => vi.mocked(useAuth).mockReturnValue({ user: { id }, isSessionVerified: true, isLoggingOut: false } as ReturnType<typeof useAuth>);

  function Probe({ value }: { value: CustomerDeliverySnapshot | undefined }) {
    const live = useDeliveryLiveUpdates(reference, value);
    return <div>
      <span data-testid="state">{live.state}</span>
      <span data-testid="announce">{live.announcement}</span>
      <span data-testid="notices">{live.notices.map(notice => notice.title).join('|')}</span>
      <ConnectionStatusPill state={live.state} />
      <ConnectionStatusBanner state={live.state} lastSaved={null} onRefresh={() => void live.refreshNow()} refreshing={live.refreshing} />
    </div>;
  }
  const mount = (userId: string, value = snapshot()) => {
    client.setQueryData(key(userId), { data: value });
    return render(<QueryClientProvider client={client}><Probe value={value} /></QueryClientProvider>);
  };
  const state = () => screen.getByTestId('state').textContent;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sockets = [];
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setDeliverySocketFactory(() => { const socket = new FakeDeliverySocket(); sockets.push(socket); return socket.asSocket(); });
    signIn('customer-a');
  });
  afterEach(() => { closeDeliverySocket(); vi.useRealTimers(); });

  it('T7-01 subscribes on connect, refetches REST, then shows "Live updates on"; merges the next revision and announces status changes', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    mount('customer-a');
    expect(sockets).toHaveLength(1);
    await act(async () => { sockets[0]!.serverAccept(); });
    expect(sockets[0]!.emitted[0]).toEqual({ event: 'delivery:subscribe', payload: { orderReference: reference } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key('customer-a'), exact: true });
    expect(state()).toBe('connected');
    expect(screen.getByText('Live updates on')).toBeInTheDocument();

    await act(async () => { sockets[0]!.serverEmit('delivery:updated', event(6, { status: 'DELIVERED', location: null }, { changed: ['status'] })); });
    expect(client.getQueryData<{ data: CustomerDeliverySnapshot }>(key('customer-a'))?.data.revision).toBe(6);
    expect(screen.getByTestId('announce').textContent).toBe('Your order was delivered.');
    expect(screen.getByTestId('notices').textContent).toBe('Your order was delivered.');
    // Location ticks are never announced.
    await act(async () => { sockets[0]!.serverEmit('delivery:updated', event(7, { status: 'DELIVERED' })); });
    expect(screen.getByTestId('notices').textContent).toBe('Your order was delivered.');
  });

  it('T7-08 in the hook: duplicate ignored, gap refetches', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    mount('customer-a');
    await act(async () => { sockets[0]!.serverAccept(); });
    invalidate.mockClear();
    await act(async () => { sockets[0]!.serverEmit('delivery:updated', event(5)); });
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { sockets[0]!.serverEmit('delivery:updated', event(7)); });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<{ data: CustomerDeliverySnapshot }>(key('customer-a'))?.data.revision).toBe(5);
  });

  it('T7-07 / T7-11 a drop shows Reconnecting…, becomes paused after 10 s (announced once), and reconnect resyncs with a REST refetch', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    mount('customer-a');
    await act(async () => { sockets[0]!.serverAccept(); });
    await act(async () => { sockets[0]!.serverDrop(); });
    expect(state()).toBe('reconnecting');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(state()).toBe('paused');
    expect(screen.getByTestId('announce').textContent).toBe('Live updates paused. Showing the last saved status.');
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeInTheDocument();
    invalidate.mockClear();
    await act(async () => { sockets[0]!.serverAccept(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key('customer-a'), exact: true });
    expect(state()).toBe('resynced');
    expect(screen.getByText('Back online · up to date')).toBeInTheDocument();
    expect(screen.getByTestId('announce').textContent).toBe('Live updates restored. Tracking is up to date.');
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(state()).toBe('connected');
  });

  it('T7-11 a socket server that never answers leaves REST data and the paused banner', async () => {
    mount('customer-a');
    await act(async () => { sockets[0]!.serverEmit('connect_error', new Error('xhr poll error')); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(state()).toBe('paused');
  });

  it('T7-06 account switch: the old socket is closed and a late event for the old user never reaches the new user\'s cache', async () => {
    const view = mount('customer-a');
    const first = sockets[0]!;
    await act(async () => { first.serverAccept(); });
    signIn('customer-b');
    client.setQueryData(key('customer-b'), { data: snapshot({ revision: 2 }) });
    view.rerender(<QueryClientProvider client={client}><Probe value={snapshot({ revision: 2 })} /></QueryClientProvider>);
    expect(first.disconnects).toBe(1);
    expect(sockets).toHaveLength(2);
    first.serverEmit('delivery:updated', event(3));
    first.serverEmit('delivery:updated', event(6));
    expect(client.getQueryData<{ data: CustomerDeliverySnapshot }>(key('customer-b'))?.data.revision).toBe(2);
    expect(client.getQueryData<{ data: CustomerDeliverySnapshot }>(key('customer-a'))?.data.revision).toBe(5);
  });

  it('T7-05 a delivered order stops updates on purpose and opens no socket', () => {
    mount('customer-a', snapshot({ status: 'DELIVERED', location: null }));
    expect(sockets).toHaveLength(0);
    expect(screen.getByText('Updates stopped (delivered)')).toBeInTheDocument();
  });

  it('T7-14 session:expired refreshes through the REST path and reconnects the same socket', async () => {
    const { refreshAccessToken } = await import('@/lib/api');
    mount('customer-a');
    const socket = sockets[0]!;
    const connect = vi.spyOn(socket, 'connect');
    await act(async () => { socket.serverAccept(); socket.serverEmit('session:expired', { v: 1 }); socket.serverDrop('io server disconnect'); });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('delivery:revoked refetches and unsubscribes', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    mount('customer-a');
    await act(async () => { sockets[0]!.serverAccept(); });
    invalidate.mockClear();
    await act(async () => { sockets[0]!.serverEmit('delivery:revoked', { v: 1, orderReference: reference, reason: 'ORDER_CANCELLED' }); });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.emitted.at(-1)).toEqual({ event: 'delivery:unsubscribe', payload: { orderReference: reference } });
  });
});
