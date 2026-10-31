import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { DeliveryTrackingPage } from './DeliveryTrackingPage';
import { locationFreshness, stageTimes } from './presentation';
import type { CustomerDeliverySnapshot } from './types';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
// Task 04.6: the lazy Leaflet chunk is replaced by a probe that records whether it was ever requested (AC4).
const mapChunk = vi.hoisted(() => ({ requested: 0 }));
vi.mock('./map/LeafletDeliveryMap', () => {
  mapChunk.requested++;
  return { default: ({ layers }: { layers: { line: { kind: string } | null } }) => <div data-testid="map-probe">{layers.line?.kind ?? 'no-line'}</div> };
});

const reference = 'ORD-7F3A21C0-9B4E-4D1A-8C55-2E0A6B1F93D4';
const now = '2026-11-04T10:48:00.000Z';
function snapshot(overrides: Partial<CustomerDeliverySnapshot> = {}): CustomerDeliverySnapshot {
  return { orderReference: reference, availability: 'AVAILABLE', status: 'OUT_FOR_DELIVERY', paymentState: 'PAID', revision: 4,
    trackingReference: 'EH-TRK-4K9Q2M7XPA', deliveryMethod: 'EXPRESS',
    eta: { estimatedAt: '2026-11-05T14:00:00.000Z', updatedAt: '2026-11-04T09:15:00.000Z', promisedStart: '2026-11-04T00:00:00.000Z', promisedEnd: '2026-11-06T00:00:00.000Z' },
    location: { latitude: 33.89, longitude: 35.5, label: 'Downtown Distribution Point', updatedAt: '2026-11-04T10:42:00.000Z', source: 'MANUAL' },
    deliveredAt: null, isSimulated: false, serverTime: now,
    timeline: [
      { id: 'e3:status', type: 'STATUS_CHANGED', occurredAt: '2026-11-04T09:12:00.000Z', status: 'OUT_FOR_DELIVERY' },
      { id: 'e2:status', type: 'STATUS_CHANGED', occurredAt: '2026-11-03T08:30:00.000Z', status: 'PREPARING' },
      { id: 'e1', type: 'TRACKING_STARTED', occurredAt: '2026-11-02T09:04:00.000Z', status: 'CONFIRMED' },
    ], ...overrides };
}
const signedIn = (id = 'customer') => vi.mocked(useAuth).mockReturnValue({ user: { id }, isSessionVerified: true, isInitializing: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
const resolve = (value: CustomerDeliverySnapshot) => vi.mocked(apiClient).mockResolvedValue({ data: value });
function renderPage() {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/orders/${reference}/tracking`]}><Routes>
    <Route path="/orders/:orderReference/tracking" element={<DeliveryTrackingPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('Task 04.5 delivery presentation', () => {
  it('judges staleness from server time, only while out for delivery', () => {
    expect(locationFreshness(snapshot())).toEqual({ minutes: 6, stale: false });
    expect(locationFreshness(snapshot({ serverTime: '2026-11-04T11:24:00.000Z' }))).toEqual({ minutes: 42, stale: true });
    expect(locationFreshness(snapshot({ location: null }))).toBeNull();
  });
  it('takes stage times only from recorded TRACKING_STARTED / STATUS_CHANGED rows', () => {
    expect(stageTimes(snapshot().timeline)).toEqual({ CONFIRMED: '2026-11-02T09:04:00.000Z', PREPARING: '2026-11-03T08:30:00.000Z', OUT_FOR_DELIVERY: '2026-11-04T09:12:00.000Z' });
    expect(stageTimes([])).toEqual({});
  });
});

describe('Delivery tracking page', () => {
  it('T5-01 renders header, premium overview, stepper, location text and the recorded timeline from the owned snapshot', async () => {
    signedIn(); resolve(snapshot());
    renderPage();
    const title = await screen.findByRole('heading', { level: 1, name: `Track order ${reference}` });
    expect(title).toHaveFocus();
    expect(apiClient).toHaveBeenCalledWith(`/api/orders/${reference}/delivery`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.body).toHaveTextContent('Order status: Out for Delivery'); expect(document.body).toHaveTextContent('Payment status: Paid');
    const overview = screen.getByRole('region', { name: 'Delivery overview' });
    expect(overview).toHaveTextContent('Out for delivery'); expect(overview).toHaveTextContent('Step 3 of 4 · Out for delivery');
    expect(overview).toHaveTextContent('Estimated arrival'); expect(overview).toHaveTextContent('An estimate, not a guarantee.');
    expect(overview).toHaveTextContent('Downtown Distribution Point'); expect(overview).toHaveTextContent('Recent · updated 6 min ago');
    expect(overview).toHaveTextContent('EH-TRK-4K9Q2M7XPA'); expect(overview).toHaveTextContent('Express Delivery');
    expect(overview).not.toHaveTextContent('33.89');
    const steps = within(screen.getByRole('region', { name: 'Delivery progress' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[3]).toHaveTextContent('Upcoming');
    const history = screen.getByRole('region', { name: 'Delivery history' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(3);
    expect(history.querySelector('ol')).toHaveAttribute('reversed');
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent('Latest');
    expect(screen.getByRole('link', { name: 'View order details' })).toHaveAttribute('href', `/orders/${reference}`);
    expect(screen.getByRole('link', { name: 'Back to Orders' })).toHaveAttribute('href', '/orders');
  });

  it('T5-02 paid order without tracking: truthful not-started overview and an empty, un-backfilled history', async () => {
    signedIn(); resolve(snapshot({ availability: 'NOT_STARTED', status: 'CONFIRMED', revision: 0, trackingReference: null, timeline: [], location: null,
      eta: { estimatedAt: null, updatedAt: null, promisedStart: '2026-11-04T00:00:00.000Z', promisedEnd: '2026-11-06T00:00:00.000Z' } }));
    renderPage();
    const overview = await screen.findByRole('region', { name: 'Delivery overview' });
    expect(overview).toHaveTextContent('Order confirmed'); expect(overview).toHaveTextContent('Assigned when tracking starts');
    expect(overview).toHaveTextContent('Not available yet'); expect(overview).toHaveTextContent('Originally estimated Wednesday, November 4 – Friday, November 6');
    expect(screen.queryByRole('button', { name: /copy tracking reference/i })).toBeNull();
    expect(screen.getByRole('region', { name: 'Delivery history' })).toHaveTextContent('No tracking events recorded yet.');
    expect(screen.getByText('No delivery updates recorded yet.')).toBeVisible();
  });

  it('stale and missing locations are labelled; nothing is invented', async () => {
    signedIn(); resolve(snapshot({ serverTime: '2026-11-04T11:24:00.000Z' }));
    renderPage();
    const overview = await screen.findByRole('region', { name: 'Delivery overview' });
    expect(overview).toHaveTextContent('Stale · updated 42 min ago'); expect(overview).toHaveTextContent('This may not be where your order is now.');
  });

  it('out for delivery without a location says so', async () => {
    signedIn(); resolve(snapshot({ location: null }));
    renderPage();
    expect(await screen.findByRole('region', { name: 'Delivery overview' })).toHaveTextContent('Your order is on its way. No location has been shared yet.');
    expect(screen.getByRole('region', { name: 'Delivery location' })).toHaveTextContent('No location yet');
  });

  it('delivered: final stepper state, recorded delivered time, live location switched off', async () => {
    signedIn(); resolve(snapshot({ status: 'DELIVERED', location: null, deliveredAt: '2026-11-05T13:48:00.000Z',
      eta: { estimatedAt: null, updatedAt: null, promisedStart: '2026-11-04T00:00:00.000Z', promisedEnd: '2026-11-06T00:00:00.000Z' } }));
    renderPage();
    const overview = await screen.findByRole('region', { name: 'Delivery overview' });
    expect(overview).toHaveTextContent('Live location is switched off after delivery.');
    const steps = within(screen.getByRole('region', { name: 'Delivery progress' })).getAllByRole('listitem');
    expect(steps[3]).toHaveAttribute('aria-current', 'step'); expect(steps[3]).toHaveTextContent('Completed');
  });

  it.each([
    ['PAYMENT_PENDING', 'AWAITING_CAPTURE', 'Tracking isn’t available yet'],
    ['CANCELLED', 'CANCELLED', 'This order was cancelled'],
  ] as const)('%s renders its dedicated notice instead of tracking', async (availability, status, title) => {
    signedIn(); resolve(snapshot({ availability, status, paymentState: status === 'CANCELLED' ? 'REFUNDED' : 'PENDING', trackingReference: null, location: null,
      timeline: status === 'CANCELLED' ? [{ id: 'e1', type: 'TRACKING_STARTED', occurredAt: '2026-11-02T09:04:00.000Z', status: 'CONFIRMED' }] : [] }));
    renderPage();
    expect(await screen.findByRole('heading', { name: title })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Delivery overview' })).toBeNull();
    if (status === 'CANCELLED') expect(screen.getByRole('region', { name: 'Delivery history' })).toHaveTextContent('Tracking started');
  });

  it.each([404, 400])('T5-11 %s shows the same safe not-found state', async status => {
    signedIn(); vi.mocked(apiClient).mockRejectedValue(new ApiError(status, 'Order not found.'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('network failure offers Retry and recovers', async () => {
    signedIn(); vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(503, 'Unavailable'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Tracking could not be loaded' })).toBeVisible();
    resolve(snapshot()); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: `Track order ${reference}` })).toBeVisible();
  });

  it('makes no private request before the session is verified', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'customer' }, isSessionVerified: false, isInitializing: true, isAuthenticated: false } as ReturnType<typeof useAuth>);
    renderPage();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('Copy puts the server reference on the clipboard and announces it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    signedIn(); resolve(snapshot());
    renderPage();
    const button = await screen.findByRole('button', { name: 'Copy tracking reference EH-TRK-4K9Q2M7XPA' });
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith('EH-TRK-4K9Q2M7XPA');
    expect(button).toHaveTextContent('Copied');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Tracking reference copied.');
  });
});

describe('Task 04.6 map panel', () => {
  const tiles = () => { vi.stubEnv('VITE_MAP_TILE_URL', 'http://127.0.0.1:4599/{z}/{x}/{y}.png'); vi.stubEnv('VITE_MAP_ATTRIBUTION', '© OpenStreetMap contributors'); };
  const origin = { latitude: 33.9, longitude: 35.5, label: 'Hub' };
  afterEach(() => { vi.unstubAllEnvs(); });

  it('T6-02 no coordinates: text summary only, Leaflet chunk never requested', async () => {
    tiles(); signedIn(); mapChunk.requested = 0;
    resolve(snapshot({ location: null, map: { origin, destination: null, path: [], pathKind: 'NONE' } }));
    renderPage();
    expect(await screen.findByText('Out for delivery, but no location has been shared yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('map-probe')).toBeNull();
    expect(mapChunk.requested).toBe(0);
  });

  it('T6-01 / T6-09 loads the lazy map below the summary when there is something to draw', async () => {
    tiles(); signedIn();
    resolve(snapshot({ isSimulated: true, map: { origin, destination: null, path: [[33.89, 35.5], [33.88, 35.51]], pathKind: 'SIMULATED_FIXTURE' } }));
    renderPage();
    expect(await screen.findByTestId('map-probe')).toHaveTextContent('simulated');
    const summary = document.getElementById('delivery-map-summary')!;
    expect(summary.compareDocumentPosition(screen.getByTestId('map-probe')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('missing tile configuration falls back to the text summary', async () => {
    vi.stubEnv('VITE_MAP_TILE_URL', ''); signedIn();
    resolve(snapshot({ map: { origin, destination: null, path: [[33.89, 35.5], [33.88, 35.51]], pathKind: 'RECORDED' } }));
    renderPage();
    expect(await screen.findByText(/Last known location: Downtown Distribution Point/)).toBeInTheDocument();
    expect(screen.queryByTestId('map-probe')).toBeNull();
  });
});
