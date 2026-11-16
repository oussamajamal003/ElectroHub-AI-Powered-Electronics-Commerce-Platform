import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { SavedPurchaseCheckout } from './SavedPurchaseCheckout';
import { beginPaymentObservation, endPaymentObservation } from './paymentObservation';
import { cart, shipping } from './fixtures';
import type { PaymentEntryActions } from './StripePaymentSession';

const owner = 'retry-regression-customer'; const attemptId = 'retry-regression-attempt';
const calls = vi.hoisted(() => ({ confirm: vi.fn(), validate: vi.fn() }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'retry-regression-customer' }, isSessionVerified: true }) }));
vi.mock('@/lib/api', () => ({ apiClient: vi.fn() }));
vi.mock('./StripePaymentSession', () => ({ StripePaymentSession: forwardRef<PaymentEntryActions, { visible: boolean; onContinue(): void; children: ReactNode }>(function Entry(props, ref) {
  useImperativeHandle(ref, () => ({ confirm: calls.confirm, validate: calls.validate }));
  return <><div hidden={!props.visible}><h2>Secure card entry fixture</h2><button onClick={props.onContinue}>Review Order</button></div>{props.children}</>;
}) }));
const declined = { attemptId, state: 'DECLINED', classification: 'DECLINED', retryAllowed: true, recoveryActive: false,
  updatedAt: '2026-10-16T08:02:00Z', intentId: 'pi_retry_fixture', committed: false, confirmation: null,
  total: '199.00', currency: 'USD', cart, orderReference: null };
const setup = { ...declined, clientSecret: 'pi_retry_fixture_secret_fixture', items: [{ name: 'Saved A', quantity: 1 }],
  request: { shipping, deliveryMethod: 'STANDARD' }, delivery: null };
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search}</output>; }
function show(step = 'payment') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/checkout?step=${step}`]}><Location /><Routes>
    <Route path="/checkout" element={<SavedPurchaseCheckout attemptId={attemptId} />} />
    <Route path="/checkout/confirmation/:reference" element={<h1>Unexpected confirmation</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); endPaymentObservation(owner, attemptId);
  calls.validate.mockResolvedValue(null); calls.confirm.mockResolvedValue({ kind: 'confirmed' });
  vi.mocked(apiClient).mockImplementation(async url => ({ data: String(url).endsWith('/resume') ? setup : declined }));
});
afterEach(() => { endPaymentObservation(owner, attemptId); });
it('a NEW authoritative decline retires an old submitted marker and opens card entry, without confirming or reconciling', async () => {
  beginPaymentObservation(owner, { ...declined, updatedAt: '2026-10-16T08:01:00Z' });
  show();
  expect(await screen.findByRole('heading', { name: 'Secure card entry fixture' })).toBeVisible();
  expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('/resume'), expect.anything());
  expect(vi.mocked(apiClient).mock.calls.some(([url]) => String(url).endsWith('/reconcile'))).toBe(false);
  expect(calls.confirm).not.toHaveBeenCalled();
});
it('a restored Review URL requires card validation again before Review or Place Order', async () => {
  show('review');
  expect(await screen.findByRole('heading', { name: 'Secure card entry fixture' })).toBeVisible();
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checkout?step=payment'));
  expect(screen.queryByRole('button', { name: /Place Order/ })).not.toBeInTheDocument();
  expect(calls.confirm).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review Order' })); });
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('step=review'));
  expect(calls.validate).toHaveBeenCalledTimes(1); expect(calls.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Place Order/ })).toBeEnabled();
});
it('an unchanged old decline cannot erase an unresolved submission and enable card entry', async () => {
  beginPaymentObservation(owner, declined); show();
  expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  expect(vi.mocked(apiClient).mock.calls.some(([url]) => String(url).endsWith('/resume'))).toBe(false);
  expect(calls.confirm).not.toHaveBeenCalled();
});

// Regression (Continue to payment stuck loading): a routine recovery lease (recoveryActive for ~1 s) on a saved checkout is not a payment
// in flight. It is waited out and card entry opens, instead of 'Checking your payment' until the recovery window lapses.
// Only a decline (or bank verification) reopens card entry; a submitted purchase at card entry is Processing and never resumes.
const saved = { ...declined, updatedAt: '2026-10-16T08:05:00Z' };
it('a transient recovery lease on a saved checkout is waited out and opens a fresh card entry', async () => {
  let reads = 0;
  vi.mocked(apiClient).mockImplementation(async url => ({ data: String(url).endsWith('/resume') ? { ...setup, ...saved }
    : { ...saved, recoveryActive: reads++ === 0 } }));
  show();
  expect(await screen.findByRole('heading', { name: 'Secure card entry fixture' }, { timeout: 4_000 })).toBeVisible();
  expect(reads).toBe(2);
  expect(vi.mocked(apiClient).mock.calls.filter(([url]) => String(url).endsWith('/resume'))).toHaveLength(1);
  expect(calls.confirm).not.toHaveBeenCalled();
});
it('a genuinely processing purchase is still observed, never resumed into card entry', async () => {
  vi.mocked(apiClient).mockImplementation(async () => ({ data: { ...saved, state: 'AWAITING_INPUT', classification: 'PROCESSING', retryAllowed: false } }));
  show();
  expect(await screen.findByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  expect(vi.mocked(apiClient).mock.calls.some(([url]) => String(url).endsWith('/resume'))).toBe(false);
  expect(calls.confirm).not.toHaveBeenCalled();
});
// DEV 2026-10-17 measured recovery passes of p50 4.3 s / p90 10.6 s: a lease spanning several reads is still waited out.
it('a multi-second recovery lease on a saved checkout is waited out and opens card entry', async () => {
  let reads = 0;
  vi.mocked(apiClient).mockImplementation(async url => ({ data: String(url).endsWith('/resume') ? { ...setup, ...saved }
    : { ...saved, recoveryActive: reads++ < 4 } }));
  show();
  expect(await screen.findByRole('heading', { name: 'Secure card entry fixture' }, { timeout: 8_000 })).toBeVisible();
  expect(reads).toBe(5); expect(calls.confirm).not.toHaveBeenCalled();
}, 12_000);

// Task 04.0: a successful retry of a failed payment is announced exactly once by the single global toast owner.
it('a successful retry announces "Order confirmed" once and opens the confirmation', async () => {
  const announced: unknown[] = [];
  const listener = (event: Event) => announced.push((event as CustomEvent).detail);
  window.addEventListener('electrohub:order-confirmed', listener);
  try {
    const confirmation = { orderReference: 'ORD-RETRY-0001', paymentState: 'PAID', items: [{ productName: 'Saved A', quantity: 1, imageUrl: null }] };
    const paid = { ...setup, clientSecret: null, state: 'PAID', classification: 'SUCCEEDED', retryAllowed: false, committed: true, orderReference: 'ORD-RETRY-0001', confirmation };
    let reconciled = false;
    vi.mocked(apiClient).mockImplementation(async url => {
      const path = String(url);
      if (path.endsWith('/resume')) return { data: setup };
      if (path.endsWith('/reconcile')) { reconciled = true; return { data: paid }; }
      return { data: reconciled ? paid : declined };
    });
    show('payment');
    expect(await screen.findByRole('heading', { name: 'Secure card entry fixture' })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review Order' })); });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('step=review'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Place Order/ })); });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checkout/confirmation/ORD-RETRY-0001'));
    expect(announced).toEqual([{ owner, attemptId, orderReference: 'ORD-RETRY-0001' }]);
  } finally { window.removeEventListener('electrohub:order-confirmed', listener); }
});
