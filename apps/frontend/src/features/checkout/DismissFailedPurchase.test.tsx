import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from '@/lib/api';
import { DismissFailedPurchase, REMOVAL_CONFIRM_POLL_MS, REMOVAL_CONFIRM_TIMEOUT_MS, type FailedPaymentRemoval } from './DismissFailedPurchase';

vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

const attemptId = '33333333-3333-4333-8333-333333333333';
const discardUrl = `/api/checkout/payment-attempts/${attemptId}/discard`;
const trigger = () => screen.getByRole('button', { name: 'Remove failed payment for Item A' });

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

function renderControl(removal: FailedPaymentRemoval | null | undefined = 'REMOVE', props: Partial<Parameters<typeof DismissFailedPurchase>[0]> = {}) {
  const onDismissed = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><DismissFailedPurchase attemptId={attemptId} label="Item A" removal={removal} onDismissed={onDismissed} {...props} /></QueryClientProvider>);
  return onDismissed;
}

describe('Remove failed payment — an already terminal failure (REMOVE)', () => {
  it('opens a confirmation that explains the card is hidden, not the record deleted', () => {
    renderControl();
    fireEvent.click(trigger());
    expect(screen.getByRole('heading', { name: 'Remove this failed payment?' })).toBeInTheDocument();
    expect(screen.getByText(/Your payment history will be preserved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel & Remove' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog and sends nothing', () => {
    const onDismissed = renderControl();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Remove this failed payment?' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('sends one owner-scoped request and removes the card only after the server confirms', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: { attemptId, status: 'REMOVED', dismissedAt: '2026-10-15T10:00:00.000Z' } });
    const onDismissed = renderControl();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onDismissed).toHaveBeenCalledWith(attemptId));
    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(apiClient).toHaveBeenCalledWith(discardUrl, expect.objectContaining({ method: 'POST', data: {} }));
  });

  it('a double-click sends a single request', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiClient).mockReturnValue(new Promise(done => { resolve = done; }) as never);
    const onDismissed = renderControl();
    fireEvent.click(trigger());
    const remove = screen.getByRole('button', { name: 'Remove' });
    fireEvent.click(remove); fireEvent.click(remove);
    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(remove).toBeDisabled();
    await act(async () => { resolve({ data: { attemptId, status: 'REMOVED', dismissedAt: '2026-10-15T10:00:00.000Z' } }); });
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it('keeps the card and shows a recoverable error when the server fails', async () => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(500, 'Server error'));
    const onDismissed = renderControl();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/could not be removed\. Your purchase is unchanged/)).toBeInTheDocument();
    expect(onDismissed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('explains a refused removal (for example, a recovery pass holding the payment)', async () => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(409, 'Conflict', undefined, 'PAYMENT_NOT_DISMISSIBLE'));
    const onDismissed = renderControl();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/can’t be removed right now/)).toBeInTheDocument();
    expect(onDismissed).not.toHaveBeenCalled();
  });
});

describe('Remove failed payment — a declined payment that is still open at the provider (CANCEL_AND_REMOVE)', () => {
  it('names the financial action distinctly: "Cancel & Remove" beside "Keep payment", never two Cancel buttons', () => {
    renderControl('CANCEL_AND_REMOVE');
    fireEvent.click(trigger());
    expect(screen.getByRole('heading', { name: 'Cancel and remove this payment?' })).toBeInTheDocument();
    expect(screen.getByText(/nothing was charged/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What happens next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel & Remove' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('Keep payment closes the dialog without any request', () => {
    const onDismissed = renderControl('CANCEL_AND_REMOVE');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Keep payment' }));
    expect(apiClient).not.toHaveBeenCalled(); expect(onDismissed).not.toHaveBeenCalled();
  });

  it('removes the card immediately when the server already verified the cancellation', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: { attemptId, status: 'REMOVED', dismissedAt: '2026-10-15T10:00:00.000Z' } });
    const onDismissed = renderControl('CANCEL_AND_REMOVE');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel & Remove' }));
    await waitFor(() => expect(onDismissed).toHaveBeenCalledWith(attemptId));
    expect(apiClient).toHaveBeenCalledWith(discardUrl, expect.objectContaining({ method: 'POST' }));
  });

  it('an accepted request (CANCEL_PENDING) is not a removal: the card stays until the server confirms, then it is removed', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient)
      .mockResolvedValueOnce({ data: { attemptId, status: 'CANCEL_PENDING', dismissedAt: null } })
      .mockResolvedValueOnce({ data: { attemptId, status: 'CANCEL_PENDING', dismissedAt: null } })
      .mockResolvedValueOnce({ data: { attemptId, status: 'REMOVED', dismissedAt: '2026-10-15T10:00:00.000Z' } });
    const onDismissed = renderControl('CANCEL_AND_REMOVE');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel & Remove' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(onDismissed).not.toHaveBeenCalled();
    expect(screen.getByText('Cancelling with our payment provider…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(REMOVAL_CONFIRM_POLL_MS); });
    expect(onDismissed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(REMOVAL_CONFIRM_POLL_MS); });
    expect(onDismissed).toHaveBeenCalledWith(attemptId);
  });

  it('never claims removal when the provider has not confirmed in time: says it is still being confirmed and keeps the card', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient).mockResolvedValue({ data: { attemptId, status: 'CANCEL_PENDING', dismissedAt: null } });
    const onDismissed = renderControl('CANCEL_AND_REMOVE');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel & Remove' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(REMOVAL_CONFIRM_TIMEOUT_MS + REMOVAL_CONFIRM_POLL_MS); });
    expect(onDismissed).not.toHaveBeenCalled();
    expect(screen.getByText(/still being confirmed with our payment provider/)).toBeInTheDocument();
  });

  it('when the provider outcome changed (for example an authorization from another tab) nothing is removed and the reason is shown', async () => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(409, 'Conflict', undefined, 'PAYMENT_STATUS_UNCONFIRMED'));
    const onDismissed = renderControl('CANCEL_AND_REMOVE');
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel & Remove' }));
    expect(await screen.findByText('We need to confirm this payment’s status before it can be removed.')).toBeInTheDocument();
    expect(onDismissed).not.toHaveBeenCalled();
  });
});

describe('Remove failed payment — not safe to remove yet', () => {
  it.each([['CONFIRMING' as const], [null]])('the trash control stays and explains (removal=%s); it offers a status check, never a removal', async removal => {
    const onCheckStatus = vi.fn().mockResolvedValue(undefined);
    const onDismissed = renderControl(removal, { onCheckStatus });
    fireEvent.click(trigger());
    expect(screen.getByRole('heading', { name: 'This payment can’t be removed yet' })).toBeInTheDocument();
    expect(screen.getByText(/We need to confirm this payment’s status before it can be removed\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel & Remove' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(onCheckStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/isn’t confirmed yet, so it stays in your list/)).toBeInTheDocument();
    // A status check is a read: no removal request is sent and nothing is removed.
    expect(apiClient).not.toHaveBeenCalled(); expect(onDismissed).not.toHaveBeenCalled();
  });

  it('a requested cancellation (PENDING) shows its progress; checking completes the removal once the server has confirmed it', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: { attemptId, status: 'REMOVED', dismissedAt: '2026-10-15T10:00:00.000Z' } });
    const onDismissed = renderControl('PENDING');
    fireEvent.click(trigger());
    expect(screen.getByRole('heading', { name: 'Removal in progress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel & Remove' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(onDismissed).toHaveBeenCalledWith(attemptId));
  });

  it('while payment changes are switched off, the dialog explains and offers no write', () => {
    renderControl('CANCEL_AND_REMOVE', { unavailableReason: 'Payment actions are switched off on this server.' });
    fireEvent.click(trigger());
    expect(screen.getByText('Payment actions are switched off on this server.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel & Remove' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
