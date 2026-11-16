import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { RestoredPurchase, STATUS_READ_TIMEOUT_MS } from './RestoredPurchase';

vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
const attemptId = '66666666-6666-4666-8666-666666666666';

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter>
    <RestoredPurchase attemptId={attemptId} scope="CART_CHECKOUT" userId="customer" fallback={<p>Empty cart</p>} />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.resetAllMocks(); window.scrollTo = vi.fn(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

// Task 03.6 final closure: "Check payment status" stayed on a loader while DEV status reads took 8-37 s or hung.
it('a status read that never answers ends in a recoverable "couldn’t verify" screen, never an endless loader, and never pays', async () => {
  vi.mocked(apiClient).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    (options as { signal?: AbortSignal }).signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  show();
  await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_READ_TIMEOUT_MS + 100); });
  expect(await screen.findByRole('heading', { name: 'We couldn’t verify your payment right now' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(vi.mocked(apiClient).mock.calls.every(([, options]) => !(options as { method?: string } | undefined)?.method)).toBe(true);
});
it('a never-confirmed purchase opened from Check payment status shows Payment failed with Try Again, without claiming a decline', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: { attemptId, state: 'DECLINED', classification: 'FAILED', providerStatus: 'requires_payment_method',
    failureCode: 'PAYMENT_NOT_CONFIRMED', submittedAt: '2026-10-17T10:41:08Z', scope: 'CART_CHECKOUT', recoveryActive: false, retryAllowed: true,
    total: '959.00', currency: 'USD', orderReference: null, committed: false, confirmation: null, recoveryRemainder: null } });
  show();
  expect(await screen.findByRole('heading', { name: 'Payment Failed' })).toBeVisible();
  expect(screen.getByText(/didn’t go through, and no money was taken/)).toBeVisible();
  expect(screen.queryByText(/was declined/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
  expect(screen.queryByText(/Not completed|Restore items|closed before payment completed/)).not.toBeInTheDocument();
});

// Task 03.6: Check payment status opens at once with the saved purchase (product, quantity, total) while the first status read is in flight.
it('shows the saved purchase immediately from this tab, before the status read answers, without paying', async () => {
  vi.mocked(apiClient).mockImplementation(() => new Promise(() => undefined));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
  client.setQueryData(['payment-purchases', 'customer'], { data: [{ attemptId, scope: 'CART_CHECKOUT', state: 'AWAITING_INPUT', classification: 'PROCESSING',
    total: '959.00', currency: 'USD', pending: true, unread: false, orderReference: null, items: [{ name: 'Apple iPad Air 11', quantity: 1 }] }] });
  render(<QueryClientProvider client={client}><MemoryRouter>
    <RestoredPurchase attemptId={attemptId} scope="CART_CHECKOUT" userId="customer" fallback={<p>Empty cart</p>} />
  </MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  expect(screen.getByText(/Apple iPad Air 11 · Qty: 1/)).toBeVisible(); expect(screen.getByText('$959.00')).toBeVisible();
  expect(vi.mocked(apiClient).mock.calls.every(([, options]) => !(options as { method?: string } | undefined)?.method)).toBe(true);
});
