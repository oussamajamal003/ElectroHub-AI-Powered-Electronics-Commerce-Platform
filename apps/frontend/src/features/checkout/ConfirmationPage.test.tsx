import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { EMAIL_REFRESH_INTERVAL_MS, EMAIL_REFRESH_MAX_POLLS, emailConfirmationRefetchInterval } from '@/features/orders/emailConfirmationRefresh';
import { NOTICE_LIFETIME_MS, resetEmailNoticeWindows, useEmailNoticeWindow } from '@/features/orders/emailNoticeWindow';
import { ConfirmationPage } from './ConfirmationPage';

const apiClient = vi.fn();
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: (...args: unknown[]) => apiClient(...args) }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'customer-1' }, isSessionVerified: true }) }));

function renderAt(reference: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/checkout/confirmation/${reference}`]}>
    <Routes><Route path="/checkout/confirmation/:orderReference" element={<ConfirmationPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { apiClient.mockReset(); });

describe('ConfirmationPage error classification (Task 03.8)', () => {
  it('owner-scoped 404 (missing, or another account\'s order) says not found for this account without any order detail', async () => {
    apiClient.mockRejectedValue(new ApiError(404, 'Not found'));
    renderAt('ORD-B8EA06B6-5C13-472C-BFAE-08C01758AC5F');
    expect(await screen.findByText(/could not find this order for the signed-in account/)).toBeInTheDocument();
    expect(screen.queryByText(/ORD-B8EA06B6/)).not.toBeInTheDocument();
  });
  it('a temporary 503 or network failure is retryable and does not claim the order is missing', async () => {
    apiClient.mockRejectedValue(new ApiError(503, 'Unavailable'));
    renderAt('ORD-DEA248A3-8E1B-46FF-A378-994F73830EEA');
    expect(await screen.findByText(/could not load this confirmation right now/)).toBeInTheDocument();
    expect(screen.queryByText(/could not find/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry confirmation' })).toBeEnabled();
  });
});

describe('emailConfirmationRefetchInterval (bounded, read-only refresh)', () => {
  const owner = 'customer-1'; const reference = 'ORD-POLL-1';
  const interval = emailConfirmationRefetchInterval(owner, reference);
  const query = (state: string | undefined, dataUpdateCount = 1, fetchFailureCount = 0, createdAt = new Date().toISOString()) =>
    ({ state: { data: { data: { createdAt, ...(state ? { emailConfirmation: { state: state as 'QUEUED', updatedAt: '' } } : {}) } }, dataUpdateCount, fetchFailureCount } });
  beforeEach(() => resetEmailNoticeWindows());
  it('polls while QUEUED or DELAYED', () => {
    expect(interval(query('QUEUED'))).toBe(EMAIL_REFRESH_INTERVAL_MS);
    expect(interval(query('DELAYED'))).toBe(EMAIL_REFRESH_INTERVAL_MS);
  });
  it('stops at terminal states and for orders without a projection', () => {
    for (const state of ['SENT', 'DELIVERED', 'PARTIAL', 'UNAVAILABLE', undefined]) expect(interval(query(state))).toBe(false);
  });
  it('stops for a historical order and once the notice window has closed', () => {
    expect(interval(query('QUEUED', 1, 0, '2020-01-01T00:00:00.000Z'))).toBe(false);
    vi.useFakeTimers();
    try {
      expect(interval(query('QUEUED'))).toBe(EMAIL_REFRESH_INTERVAL_MS);
      renderHook(() => useEmailNoticeWindow({ ownerId: owner, orderReference: reference, createdAt: new Date().toISOString(), eligible: true }));
      act(() => { vi.advanceTimersByTime(NOTICE_LIFETIME_MS + 1); });
      expect(interval(query('QUEUED'))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('is bounded in count and backs off after failures', () => {
    expect(interval(query('QUEUED', EMAIL_REFRESH_MAX_POLLS))).toBe(false);
    expect(interval(query('QUEUED', 1, 2))).toBe(EMAIL_REFRESH_INTERVAL_MS * 4);
    expect(interval(query('QUEUED', 1, 4))).toBe(false);
  });
  it('pauses while the tab is hidden', () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(interval(query('QUEUED'))).toBe(false);
    spy.mockRestore();
  });
});
