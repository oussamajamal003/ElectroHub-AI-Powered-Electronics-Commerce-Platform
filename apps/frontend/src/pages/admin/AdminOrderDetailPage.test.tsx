import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { AdminOrderDetailPage } from './AdminOrderDetailPage';
import { useAdminOrder, type AdminOrderDetail } from '@/features/admin/orders/api';
import { useAdminDeliveryMutations } from '@/features/delivery/queries';
import { adminKeys } from '@/features/admin/shared/api';

vi.mock('@/features/admin/orders/api', async importOriginal => ({ ...await importOriginal<object>(), useAdminOrder: vi.fn() }));
vi.mock('@/features/delivery/queries', async importOriginal => ({ ...await importOriginal<object>(), useAdminDeliveryMutations: vi.fn() }));

const REF = 'ORD-1C5BB1A2-5F0E-4F7A-9D4E-2B8D1F0A9C11';
const mutation = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null });
let start: ReturnType<typeof mutation>;
let update: ReturnType<typeof mutation>;

function order(overrides: Partial<AdminOrderDetail> = {}, delivery: Partial<AdminOrderDetail['delivery']> = {}): AdminOrderDetail {
  return {
    orderReference: REF, status: 'CONFIRMED', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', currency: 'USD',
    subtotal: '90.00', shippingCost: '9.00', total: '99.00', deliveryMethod: 'STANDARD', paymentMethod: 'CARD',
    estimatedDeliveryStart: '2026-11-03T10:00:00.000Z', estimatedDeliveryEnd: '2026-11-05T10:00:00.000Z',
    customer: { id: '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33', name: 'QA Customer', email: 'qa.customer@example.test', isActive: true },
    shipping: { recipient: 'QA Customer', line1: '1 Test Street', line2: null, city: 'Testville', state: null, postalCode: '00000', country: 'US', phone: '+10000000000' },
    items: [], itemCount: 0,
    payment: { state: 'PAID', amount: '99.00', currency: 'USD', paidAt: '2026-11-01T10:01:00.000Z', refundedAt: null, card: null },
    delivery: { availability: 'AVAILABLE', paymentEligible: true, canStart: false, allowedNextStatus: null, revision: null, trackingReference: null,
      estimatedAt: null, deliveredAt: null, isSimulated: false, ...delivery },
    ...overrides,
  };
}

function renderPage(detail: AdminOrderDetail) {
  vi.mocked(useAdminOrder).mockReturnValue({ data: { data: detail }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() } as never);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/admin/orders/${REF}`]}>
    <Routes><Route path="/admin/orders/:orderReference" element={<AdminOrderDetailPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  return { invalidate };
}

describe('AdminOrderDetailPage fulfillment panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    start = mutation(); update = mutation();
    vi.mocked(useAdminDeliveryMutations).mockReturnValue({ start, update } as never);
  });

  it('starts tracking through the 04.5 delivery API only after confirmation', () => {
    renderPage(order({}, { canStart: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Start tracking' }));
    expect(start.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start tracking' }));
    expect(start.mutate).toHaveBeenCalledWith(undefined, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it('advances one allowed step with the current revision, never a status the server did not offer', () => {
    renderPage(order({ status: 'PREPARING' }, { allowedNextStatus: 'OUT_FOR_DELIVERY', revision: 3, trackingReference: 'TRK-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Out for delivery' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(update.mutate).toHaveBeenCalledWith({ expectedRevision: 3, status: 'OUT_FOR_DELIVERY' }, expect.anything());
    expect(start.mutate).not.toHaveBeenCalled();
  });

  it('reloads the order when the server reports a conflict (stale revision or terminal order)', () => {
    update.mutate.mockImplementation((_body, options: { onError: (error: unknown) => void }) =>
      options.onError(new ApiError(409, 'Delivery changed.', undefined, 'DELIVERY_REVISION_CONFLICT')));
    const { invalidate } = renderPage(order({ status: 'PREPARING' }, { allowedNextStatus: 'OUT_FOR_DELIVERY', revision: 3, trackingReference: 'TRK-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Out for delivery' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminKeys.order(REF) });
  });

  it('offers no fulfillment action for cancelled, unpaid or delivered orders', () => {
    for (const status of ['CANCELLED', 'AWAITING_CAPTURE', 'DELIVERED'] as const) {
      renderPage(order({ status }));
      expect(screen.queryByRole('button', { name: /Start tracking|Mark as/ }), status).toBeNull();
      cleanup();
    }
  });

  it('explains when a payment problem blocks fulfillment', () => {
    renderPage(order({ payment: { state: 'REFUNDED', amount: '99.00', currency: 'USD', paidAt: null, refundedAt: '2026-11-02T10:00:00.000Z', card: null } },
      { paymentEligible: false }));
    expect(screen.queryByRole('button', { name: /Start tracking|Mark as/ })).toBeNull();
    expect(screen.getByText("Fulfillment needs a successful payment. This order's payment is refunded.")).toBeInTheDocument();
  });
});
