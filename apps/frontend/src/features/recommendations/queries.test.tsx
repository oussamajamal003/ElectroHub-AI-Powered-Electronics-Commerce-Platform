import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query';
import { recommendationsApi } from './api';
import { resolvePersonalResponse, useClearRecentlyViewed, usePersonalRecommendations, useRemoveRecentlyViewed, useSetRecommendationPreferences } from './queries';
import type { PersonalRecommendations, RecommendationPreferences } from './types';

vi.mock('./api', async importOriginal => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, recommendationsApi: { ...actual.recommendationsApi, removeRecentlyViewed: vi.fn(), clearRecentlyViewed: vi.fn(), personal: vi.fn(), setPreferences: vi.fn() } };
});

const history = {
  data: { personalizationEnabled: true, items: [{ id: 'p1' }, { id: 'p2' }] },
};

describe('initial personal recommendation recovery', () => {
  it('retries an initial AI outage once and uses the recovered personalized response', async () => {
    const unavailable: { data: PersonalRecommendations } = { data: { mode: 'RECOMMENDED_FOR_YOU', surface: 'home', strategy: 'NO_DATA',
      fallbackReason: 'AI_UNAVAILABLE', isPersonalized: false, isFallback: true, modelVersion: null, embeddingVersion: null,
      algorithmVersion: 'none', context: null, impressionToken: null, profile: null, items: [] } };
    const recovered: { data: PersonalRecommendations } = { data: { ...unavailable.data, fallbackReason: null, strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: true, isFallback: false } };
    vi.mocked(recommendationsApi.personal).mockReset()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(recovered);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePersonalRecommendations('user-1', 4), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(recovered));
    expect(recommendationsApi.personal).toHaveBeenCalledTimes(2);
  });

  it('does not retry a legitimate insufficient-history response', async () => {
    const response: { data: PersonalRecommendations } = { data: { mode: 'RECOMMENDED_FOR_YOU', surface: 'home', strategy: 'NO_DATA',
      fallbackReason: 'INSUFFICIENT_HISTORY', isPersonalized: false, isFallback: true, modelVersion: null, embeddingVersion: null,
      algorithmVersion: 'none', context: null, impressionToken: null, profile: null, items: [] } };
    vi.mocked(recommendationsApi.personal).mockReset().mockResolvedValue(response);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePersonalRecommendations('user-1', 4), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(recommendationsApi.personal).toHaveBeenCalledTimes(1);
  });
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = queryKeys.recommendations.recentlyViewed('user-1');
  client.setQueryData(key, history);
  client.setQueryData(queryKeys.recommendations.preferences('user-1'), { data: { personalizationEnabled: true, updatedAt: null } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, key, ...renderHook(() => useRemoveRecentlyViewed('user-1'), { wrapper }) };
}

function setupClear() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = queryKeys.recommendations.recentlyViewed('user-1');
  client.setQueryData(key, history);
  client.setQueryData(queryKeys.recommendations.preferences('user-1'), { data: { personalizationEnabled: true, updatedAt: null } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, key, ...renderHook(() => useClearRecentlyViewed('user-1'), { wrapper }) };
}

describe('useRemoveRecentlyViewed', () => {
  beforeEach(() => {
    vi.mocked(recommendationsApi.removeRecentlyViewed).mockReset();
    vi.mocked(recommendationsApi.clearRecentlyViewed).mockReset();
    vi.mocked(recommendationsApi.personal).mockReset();
  });

  it('removes the product optimistically and keeps other history', async () => {
    vi.mocked(recommendationsApi.removeRecentlyViewed).mockResolvedValue(undefined);
    const { client, key, result } = setup();
    act(() => result.current.mutate('p1'));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ data: { personalizationEnabled: true, items: [{ id: 'p2' }] } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('restores the cached list when removal fails', async () => {
    vi.mocked(recommendationsApi.removeRecentlyViewed).mockRejectedValue(new Error('request failed'));
    const { client, key, result } = setup();
    act(() => result.current.mutate('p1'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual(history);
  });

  it('uses the user scoped key and cancels an in-flight history read before updating', async () => {
    vi.mocked(recommendationsApi.removeRecentlyViewed).mockResolvedValue(undefined);
    const { client, key, result } = setup();
    const cancel = vi.spyOn(client, 'cancelQueries');
    act(() => result.current.mutate('p1'));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ queryKey: key }));
    await waitFor(() => expect(recommendationsApi.removeRecentlyViewed).toHaveBeenCalledWith('p1'));
  });

  it('rolls back only the failed product when two removals are already in flight', async () => {
    vi.mocked(recommendationsApi.removeRecentlyViewed).mockImplementation(productId =>
      productId === 'p1' ? Promise.reject(new Error('first failed')) : Promise.resolve(undefined));
    const { client, key, result } = setup();
    act(() => { result.current.mutate('p1'); result.current.mutate('p2'); });
    await waitFor(() => expect(recommendationsApi.removeRecentlyViewed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ data: { personalizationEnabled: true, items: [{ id: 'p1' }] } }));
  });
});

describe('useClearRecentlyViewed', () => {
  it('cancels the private read and empties the account list optimistically', async () => {
    let finish!: () => void;
    vi.mocked(recommendationsApi.clearRecentlyViewed).mockImplementation(() => new Promise(resolve => { finish = () => resolve(undefined); }));
    const { client, key, result } = setupClear();
    const cancel = vi.spyOn(client, 'cancelQueries');
    act(() => result.current.mutate());
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ data: { personalizationEnabled: true, items: [] } }));
    expect(cancel).toHaveBeenCalledWith({ queryKey: key });
    act(() => finish());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back a failed clear while the same consented account remains active', async () => {
    vi.mocked(recommendationsApi.clearRecentlyViewed).mockRejectedValue(new Error('request failed'));
    const { client, key, result } = setupClear();
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual(history);
  });
});

describe('useSetRecommendationPreferences', () => {
  beforeEach(() => { vi.mocked(recommendationsApi.setPreferences).mockReset(); });

  function setupPreferences(enabled: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const preferenceKey = queryKeys.recommendations.preferences('user-1');
    const historyKey = queryKeys.recommendations.recentlyViewed('user-1');
    client.setQueryData(preferenceKey, { data: { personalizationEnabled: enabled, updatedAt: null } });
    client.setQueryData(historyKey, history);
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, preferenceKey, historyKey, ...renderHook(() => useSetRecommendationPreferences('user-1'), { wrapper }) };
  }

  it('applies opt-in immediately and restores the last confirmed value when save fails', async () => {
    let reject!: () => void;
    vi.mocked(recommendationsApi.setPreferences).mockImplementation(() => new Promise((_resolve, rejectPromise) => {
      reject = () => rejectPromise(new Error('request failed'));
    }));
    const { client, preferenceKey, result } = setupPreferences(false);
    let mutation!: Promise<unknown>;
    act(() => { mutation = result.current.mutateAsync(true); });
    await waitFor(() => expect(client.getQueryData(preferenceKey)).toEqual({ data: { personalizationEnabled: true, updatedAt: null } }));
    await waitFor(() => expect(recommendationsApi.setPreferences).toHaveBeenCalled());
    await act(async () => { reject(); await mutation.catch(() => undefined); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(preferenceKey)).toEqual({ data: { personalizationEnabled: false, updatedAt: null } });
  });

  it('hides history optimistically during opt-out and restores it if the server rejects', async () => {
    let reject!: () => void;
    vi.mocked(recommendationsApi.setPreferences).mockImplementation(() => new Promise((_resolve, rejectPromise) => {
      reject = () => rejectPromise(new Error('request failed'));
    }));
    const { client, preferenceKey, historyKey, result } = setupPreferences(true);
    let mutation!: Promise<unknown>;
    act(() => { mutation = result.current.mutateAsync(false); });
    await waitFor(() => expect(client.getQueryData(preferenceKey)).toEqual({ data: { personalizationEnabled: false, updatedAt: null } }));
    expect(client.getQueryData(historyKey)).toEqual(history);
    await waitFor(() => expect(recommendationsApi.setPreferences).toHaveBeenCalled());
    await act(async () => { reject(); await mutation.catch(() => undefined); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(preferenceKey)).toEqual({ data: { personalizationEnabled: true, updatedAt: null } });
    expect(client.getQueryData(historyKey)).toEqual(history);
  });

  it('discards private cached history only after the server confirms opt-out', async () => {
    const disabled: RecommendationPreferences = { personalizationEnabled: false, updatedAt: '2026-10-29T12:00:00.000Z' };
    vi.mocked(recommendationsApi.setPreferences).mockResolvedValue({ data: disabled });
    const { client, preferenceKey, historyKey, result } = setupPreferences(true);
    await act(async () => { await result.current.mutateAsync(false); });
    expect(client.getQueryData(preferenceKey)).toEqual({ data: disabled });
    expect(client.getQueryData(historyKey)).toBeUndefined();
  });
});

describe('usePersonalRecommendations', () => {
  const personal: PersonalRecommendations = {
    mode: 'RECOMMENDED_FOR_YOU', surface: 'home', strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: true,
    isFallback: false, fallbackReason: null, modelVersion: 'model-1', embeddingVersion: 'embed-1', algorithmVersion: 'v1',
    context: null, impressionToken: null, items: [{ rank: 1, product: { id: 'p1' } as never }],
    profile: { featureSpecVersion: 'v1', signalCount: 2, watermark: 'w1' },
  };
  const outage: PersonalRecommendations = {
    ...personal, strategy: 'NO_DATA', isPersonalized: false, isFallback: true, fallbackReason: 'AI_UNAVAILABLE', items: [], profile: null,
  };
  const insufficient: PersonalRecommendations = {
    ...outage, fallbackReason: 'INSUFFICIENT_HISTORY',
  };

  it('retains same-account cached personal picks only for AI_UNAVAILABLE with confirmed consent', () => {
    const retained = resolvePersonalResponse({ data: outage }, { data: personal }, true);
    expect(retained.data.isPersonalized).toBe(true);
    expect(retained.data.fallbackReason).toBe('AI_UNAVAILABLE');
    expect(retained.data.items).toHaveLength(1);
    expect(resolvePersonalResponse({ data: outage }, { data: personal }, false)).toEqual({ data: outage });
  });

  it('replaces cached personal picks for opt-out and insufficient-history responses', () => {
    expect(resolvePersonalResponse({ data: insufficient }, { data: personal }, true)).toEqual({ data: insufficient });
    const optedOut: PersonalRecommendations = { ...insufficient, fallbackReason: 'PERSONALIZATION_OFF' };
    expect(resolvePersonalResponse({ data: optedOut }, { data: personal }, true)).toEqual({ data: optedOut });
  });
});
