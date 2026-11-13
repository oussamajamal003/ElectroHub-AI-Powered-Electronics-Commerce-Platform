import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { createQueryClient } from '@/lib/query';
import { cart } from './fixtures';
import { CheckoutProcessing } from './CheckoutComponents';
import { PaymentRecovery } from './PaymentRecovery';
import type { PaymentOutcome, PaymentState } from './types';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'customer-a' }, isSessionVerified: true }) }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

/**
 * Task 06.2 WP A + B. The processing card is the shared PaymentProcessingPanel design; Cancel appears only when the backend marks the
 * attempt `cancelable`, needs a confirmation, cannot be sent twice, and the screen then re-reads the server's state instead of assuming.
 */
describe('CheckoutProcessing (e64af2af PaymentProcessingPanel design)', () => {
  it('keeps the "keep this page open" warning while the browser confirms the card and offers no action', () => {
    render(<CheckoutProcessing browserConfirming />);
    expect(screen.getByRole('heading', { name: 'Processing your order…' })).toBeVisible();
    expect(screen.getByText(/Keep this page open until this finishes/)).toBeVisible();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\d+\s?%|seconds? left|Payment confirmed/);
  });
});

function outcome(state: PaymentState, patch: Partial<PaymentOutcome> = {}): PaymentOutcome {
  return { attemptId: 'attempt-1', state, providerStatus: null, failureCode: null, total: '1.00', currency: 'USD', orderReference: null, committed: false,
    cart, confirmation: null, recoveryRemainder: null, recoveryActive: false, ...patch };
}
// Recovery verified the purchase never reached Stripe (backend cancelEligible); classification stays Processing.
const neverConfirmed = outcome('AWAITING_INPUT', { classification: 'PROCESSING', submittedAt: '2026-11-13T10:00:00.000Z', cancelable: true });

function show(value: PaymentOutcome | null, props: { pending?: boolean; message?: string; onCheck?: () => void } = {}) {
  const onCheck = props.onCheck ?? vi.fn();
  render(<QueryClientProvider client={createQueryClient()}><MemoryRouter>
    <PaymentRecovery outcome={value} message={props.message ?? ''} pending={props.pending ?? false} onCheck={onCheck} onRetry={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
  return onCheck;
}
const posts = () => vi.mocked(apiClient).mock.calls.filter(([, options]) => (options as { method?: string } | undefined)?.method === 'POST').map(([url]) => url);

describe('Checkout cancel is server-gated', () => {
  beforeEach(() => { vi.mocked(apiClient).mockReset(); });

  it('offers no Cancel for an ordinary processing, unknown or locally pending attempt', () => {
    show(outcome('PROCESSING', { classification: 'PROCESSING' }));
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    show(outcome('PROCESSING', { classification: 'UNKNOWN' }), { message: 'unknown' });
    expect(screen.getByRole('heading', { name: 'We’re still checking your payment' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check payment status' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment failed/i)).not.toBeInTheDocument();
    document.body.innerHTML = '';
    // Even a cancelable attempt hides Cancel while a status read is in flight.
    show(neverConfirmed, { pending: true });
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('a cancelable attempt asks for confirmation, sends one cancel, then re-reads the server state', async () => {
    let release!: (value: unknown) => void;
    vi.mocked(apiClient).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/cancel') && (options as { method?: string }).method === 'POST') return new Promise(done => { release = done; }) as never;
      if (String(url).endsWith('/restore')) return { data: {} } as never;
      throw new Error(`Unexpected ${String(url)}`);
    });
    const onCheck = show(neverConfirmed);
    expect(screen.getByText(/Card confirmation never reached our payment provider, so nothing was charged/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel purchase' }));
    expect(posts()).toEqual([]);                                                     // opening the dialog sends nothing
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this purchase?' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel purchase' });
    fireEvent.click(confirm); fireEvent.click(confirm);                            // duplicate click
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Keep purchase' })).toBeDisabled();
    expect(posts()).toEqual(['/api/checkout/payment-attempts/attempt-1/cancel']);
    expect(onCheck).not.toHaveBeenCalled();                                        // nothing is assumed before the server answers
    await act(async () => { release({ data: { attemptId: 'attempt-1', state: 'CANCELED' } }); });
    await waitFor(() => expect(onCheck).toHaveBeenCalledTimes(1));
    expect(posts()).toEqual(['/api/checkout/payment-attempts/attempt-1/cancel', '/api/checkout/payment-attempts/attempt-1/restore']);
  });

  it('a refused cancellation explains itself, changes nothing locally and re-reads the server state once closed', async () => {
    vi.mocked(apiClient).mockImplementation(async url => {
      if (String(url).endsWith('/cancel')) throw new ApiError(409, 'no', undefined, 'PAYMENT_CANCEL_NOT_ALLOWED');
      throw new Error(`Unexpected ${String(url)}`);
    });
    const onCheck = show(neverConfirmed);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel purchase' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel purchase' })); });
    expect(await within(dialog).findByText(/can’t be cancelled now/)).toBeInTheDocument();
    expect(onCheck).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep purchase' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(posts()).toEqual(['/api/checkout/payment-attempts/attempt-1/cancel']);
  });

  it('shows the authoritative result: cancellation still being confirmed, then Payment canceled', () => {
    show(outcome('CANCEL_PENDING', { classification: 'PROCESSING' }));
    expect(screen.getByText(/Cancellation was requested\. We’re confirming it with our payment provider/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    show(outcome('CANCELED', { classification: 'FAILED', retryAllowed: false }));
    expect(screen.getByRole('heading', { name: 'Payment canceled' })).toBeVisible();
    expect(screen.getByText('This payment was canceled. Your purchase details are saved.')).toBeVisible();
  });
});
