import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from '@/lib/api';
import { DismissFailedPurchase } from './DismissFailedPurchase';

vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

const attemptId = '33333333-3333-4333-8333-333333333333';

beforeEach(() => { vi.resetAllMocks(); });

function renderControl(onDismissed = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient()}><DismissFailedPurchase attemptId={attemptId} label="Item A" onDismissed={onDismissed} /></QueryClientProvider>);
  return onDismissed;
}

describe('DismissFailedPurchase', () => {
  it('opens a confirmation that explains the card is hidden, not the record deleted', () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed payment for Item A' }));
    expect(screen.getByRole('heading', { name: 'Remove this failed payment?' })).toBeInTheDocument();
    expect(screen.getByText(/Your payment history will be preserved/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('cancelling closes the dialog and sends nothing', () => {
    const onDismissed = renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed payment for Item A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Remove this failed payment?' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('posts an owner-scoped dismissal and reports success only after the server confirms', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: { attemptId, dismissedAt: '2026-10-15T10:00:00.000Z' } });
    const onDismissed = renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed payment for Item A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onDismissed).toHaveBeenCalledWith(attemptId));
    expect(apiClient).toHaveBeenCalledWith(`/api/checkout/payment-attempts/${attemptId}/dismiss`, expect.objectContaining({ method: 'POST' }));
  });

  it('keeps the card and shows a recoverable error when the server fails', async () => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(500, 'Server error'));
    const onDismissed = renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed payment for Item A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/could not be removed\. Your purchase is unchanged/)).toBeInTheDocument();
    expect(onDismissed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('explains a refused dismissal (for example, a payment that is now in progress)', async () => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(409, 'Conflict'));
    const onDismissed = renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Remove failed payment for Item A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/can’t be removed right now/)).toBeInTheDocument();
    expect(onDismissed).not.toHaveBeenCalled();
  });
});
