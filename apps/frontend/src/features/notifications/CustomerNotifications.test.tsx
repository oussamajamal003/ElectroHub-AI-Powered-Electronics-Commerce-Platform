import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerNotifications } from './CustomerNotifications';
const mocks = vi.hoisted(() => ({ api: vi.fn(), on: vi.fn(), off: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiClient: mocks.api }));
vi.mock('@/features/delivery/realtime/deliverySocket', () => ({ acquireDeliverySocket: () => ({ on: mocks.on, off: mocks.off }), releaseDeliverySocket: mocks.release }));
const id = '11111111-1111-4111-8111-111111111111';
const orderReference = 'ORD-22222222-2222-4222-8222-222222222222';
const item = { id, orderReference, type: 'ORDER_OUT_FOR_DELIVERY', occurredAt: '2026-11-11T12:00:00.000Z', readAt: null };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CustomerNotifications userId="customer-a" /></MemoryRouter></QueryClientProvider>);
}
describe('customer notification center', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('reconciles repeated and reconnect events without duplicating the badge, persists read and cleans listeners', async () => {
    let read = false;
    mocks.api.mockImplementation(async (url: string) => {
      if (url.endsWith('/read')) { read = true; return undefined; }
      return { data: { items: [{ ...item, readAt: read ? item.occurredAt : null }], unreadCount: read ? 0 : 1, nextBefore: null } };
    });
    const view = setup();
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    const receive = mocks.on.mock.calls.find(call => call[0] === 'notification:created')![1];
    await act(async () => { receive({ ...item, v: 1 }); receive({ ...item, v: 1 }); });
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
    fireEvent.keyDown(bell, { key: 'Enter' });
    expect(await screen.findByText(`Your order ${orderReference} is out for delivery.`)).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Your order/ })).toHaveAttribute('href', `/orders/${orderReference}/tracking`);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as read' }));
    await screen.findByText('Read');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    const reconnect = mocks.on.mock.calls.find(call => call[0] === 'connect')![1];
    await act(async () => { reconnect(); });
    expect(screen.getByRole('button', { name: 'Notifications, 0 unread' })).toBeInTheDocument();
    view.unmount(); expect(mocks.off).toHaveBeenCalledTimes(2); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('shows loading and ignores malformed or unrelated socket events', async () => {
    mocks.api.mockImplementation(() => new Promise(() => undefined));
    const view = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Notifications' }), { key: 'Enter' });
    expect(await screen.findByRole('status')).toHaveTextContent('Loading notifications');
    const receive = mocks.on.mock.calls.find(call => call[0] === 'notification:created')![1];
    const calls = mocks.api.mock.calls.length;
    await act(async () => { receive({ v: 1, type: 'ORDER_SHIPPED' }); receive({ ...item, v: 2 }); });
    expect(mocks.api).toHaveBeenCalledTimes(calls);
    view.unmount();
  });
  it('shows an empty state and offers retry after a failed read', async () => {
    mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { items: [], unreadCount: 0, nextBefore: null } });
    setup(); fireEvent.keyDown(screen.getByRole('button', { name: 'Notifications' }), { key: 'Enter' });
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    // Reconciliation may share the first request; retry remains a real user action.
    const retry = await screen.findByRole('menuitem', { name: 'Retry' }); fireEvent.click(retry);
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });
});
