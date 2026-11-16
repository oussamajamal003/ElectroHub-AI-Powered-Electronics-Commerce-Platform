import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recommendationsApi } from './api';
import { forgetRecordedProductViews, useRecordProductView, useRemoveRecentlyViewed } from './queries';
import { queryKeys } from '@/lib/query';

vi.mock('./api', () => ({
  recommendationsApi: {
    recordInteraction: vi.fn().mockResolvedValue({ data: { recorded: true, reason: null } }),
    removeRecentlyViewed: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useRecordProductView', () => {
  const recordInteraction = vi.mocked(recommendationsApi.recordInteraction);
  let client: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    recordInteraction.mockClear();
    for (const userId of ['customer-a', 'customer-b', 'consent-user', 'switch-a', 'switch-b', 'remove-user']) forgetRecordedProductViews(userId);
    recordInteraction.mockResolvedValue({ data: { recorded: true, reason: null } });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    client.clear();
    vi.useRealTimers();
  });

  it('deduplicates per account and records again after consent withdrawal erases local history', async () => {
    const hook = renderHook(
      ({ userId, enabled }: { userId: string | undefined; enabled: boolean }) =>
        useRecordProductView('product-1', userId, enabled),
      { initialProps: { userId: 'customer-a' as string | undefined, enabled: true }, wrapper },
    );
    await act(async () => { await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(1);

    const firstKey = recordInteraction.mock.calls[0]?.[0].idempotencyKey;
    expect(firstKey).not.toContain('customer-a');

    // Consent withdrawal erases server history and clears this account's
    // in-memory dedupe, allowing the same stable server key to be used again.
    hook.rerender({ userId: 'customer-a', enabled: false });
    hook.rerender({ userId: 'customer-a', enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    const reenabledKey = recordInteraction.mock.calls[1]?.[0].idempotencyKey;
    expect(reenabledKey).toBe(firstKey);
    expect(reenabledKey).not.toContain('customer-a');

    hook.rerender({ userId: 'customer-b', enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(3);
    expect(recordInteraction).toHaveBeenNthCalledWith(3, expect.objectContaining({ productId: 'product-1', eventType: 'VIEW' }));

    hook.rerender({ userId: undefined, enabled: true });
    hook.rerender({ userId: 'customer-b', enabled: true });
    await act(async () => { await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(3);
    hook.unmount();
  });

  it('re-sends a genuine same-window revisit with the same key so history order refreshes, but not on re-render', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const first = renderHook(() => useRecordProductView('product-revisit', 'revisit-user', true), { wrapper });
    await act(async () => { await Promise.resolve(); });
    first.rerender();
    await act(async () => { await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(1);
    first.unmount();

    recordInteraction.mockResolvedValueOnce({ data: { recorded: false, reason: 'DUPLICATE', historyUpdated: true } });
    invalidate.mockClear();
    const revisit = renderHook(() => useRecordProductView('product-revisit', 'revisit-user', true), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    expect(recordInteraction.mock.calls[1]?.[0].idempotencyKey).toBe(recordInteraction.mock.calls[0]?.[0].idempotencyKey);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recommendations.recentlyViewed('revisit-user') });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['recommendations', 'personal', 'revisit-user'] });
    revisit.unmount();
    forgetRecordedProductViews('revisit-user');
  });

  it('retries a rejected request once with the same key and tracks the next product after navigation', async () => {
    recordInteraction.mockRejectedValueOnce(new Error('temporary failure'));
    const hook = renderHook(
      ({ productId }: { productId: string }) => useRecordProductView(productId, 'customer-a', true),
      { initialProps: { productId: 'product-1' }, wrapper },
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    expect(recordInteraction.mock.calls[1]?.[0].idempotencyKey).toBe(recordInteraction.mock.calls[0]?.[0].idempotencyKey);

    hook.rerender({ productId: 'product-2' });
    await act(async () => { await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(3);
    expect(recordInteraction.mock.calls[2]?.[0].productId).toBe('product-2');
    hook.rerender({ productId: 'product-2' });
    expect(recordInteraction).toHaveBeenCalledTimes(3);
    hook.unmount();
  });

  it('does not retry a failed request after the mounted instance switches accounts', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    recordInteraction.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    const hook = renderHook(
      ({ userId }: { userId: string }) => useRecordProductView('product-1', userId, true),
      { initialProps: { userId: 'switch-a' }, wrapper },
    );
    expect(recordInteraction).toHaveBeenCalledTimes(1);

    hook.rerender({ userId: 'switch-b' });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    await act(async () => { rejectFirst?.(new Error('temporary failure')); await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('does not replay an old failed view after consent is withdrawn and restored', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    recordInteraction.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    const hook = renderHook(({ enabled }: { enabled: boolean }) => useRecordProductView('product-1', 'consent-user', enabled),
      { initialProps: { enabled: true }, wrapper });
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    await act(async () => { rejectFirst?.(new Error('late failure')); await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('allows a fresh same-bucket view after the server confirms single-item history removal', async () => {
    const firstView = renderHook(() => useRecordProductView('product-1', 'remove-user', true), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(1);

    client.setQueryData(queryKeys.recommendations.preferences('remove-user'), {
      data: { personalizationEnabled: true, updatedAt: null },
    });
    client.setQueryData(queryKeys.recommendations.recentlyViewed('remove-user'), {
      data: { personalizationEnabled: true, items: [{ id: 'product-1' }] },
    });
    const removal = renderHook(() => useRemoveRecentlyViewed('remove-user'), { wrapper });
    await act(async () => { await removal.result.current.mutateAsync('product-1'); });
    firstView.unmount();

    renderHook(() => useRecordProductView('product-1', 'remove-user', true), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(recordInteraction).toHaveBeenCalledTimes(2);
    expect(recordInteraction.mock.calls[1]?.[0].idempotencyKey).toBe(recordInteraction.mock.calls[0]?.[0].idempotencyKey);
  });
});
