import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogSignal, queryKeys } from '@/lib/query';
import { recommendationsApi } from './api';
import type { ProductSummary } from '@/features/products/types';
import type { PersonalRecommendations, RecommendationPreferences } from './types';
import { isAbortError } from '@/lib/api';

/** Recommendations are optional enhancements: short freshness, no retry storm, never a page-level failure. */
const recommendationPolicy = { staleTime: 60_000, gcTime: 5 * 60_000, retry: 1 } as const;
const privatePolicy = { staleTime: 30_000, gcTime: 2 * 60_000, retry: false } as const;
const recordedViewsByUser = new Map<string, Set<string>>();

/** Forget the local 30-minute dedupe after server history deletion so a later view can be recorded again. */
export function forgetRecordedProductViews(userId: string, productId?: string) {
  const recorded = recordedViewsByUser.get(userId);
  if (!recorded) return;
  if (!productId) {
    recordedViewsByUser.delete(userId);
    return;
  }
  for (const key of recorded) if (key.startsWith(`view:${productId}:`)) recorded.delete(key);
  if (recorded.size === 0) recordedViewsByUser.delete(userId);
}

function recordedViewsFor(userId: string, bucket: number) {
  let recorded = recordedViewsByUser.get(userId);
  if (!recorded) {
    recorded = new Set();
    recordedViewsByUser.set(userId, recorded);
  }
  for (const key of recorded) if (!key.endsWith(`:${bucket}`)) recorded.delete(key);
  return recorded;
}

export function useProductRecommendations(slug: string, limit: number, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.recommendations.product(slug, limit),
    queryFn: context => recommendationsApi.product(slug, limit, catalogSignal(context)),
    enabled: enabled && Boolean(slug), ...recommendationPolicy });
}

export function usePopularRecommendations(limit: number, enabled = true) {
  return useQuery({ queryKey: queryKeys.recommendations.popular(limit),
    queryFn: context => recommendationsApi.popular(limit, catalogSignal(context)), enabled, ...recommendationPolicy });
}

export function useCartRecommendations(productIds: string[], limit: number) {
  const key = [...new Set(productIds)].sort().join(',');
  return useQuery({ queryKey: queryKeys.recommendations.cart(key, limit),
    queryFn: ({ signal }) => recommendationsApi.cart(key.split(','), limit, signal),
    enabled: key.length > 0, ...recommendationPolicy });
}

/** `userId` is part of the key, so a cached list can never be shown to a different account. */
export function usePersonalRecommendations(userId: string | undefined, limit: number) {
  const client = useQueryClient();
  const key = queryKeys.recommendations.personal(userId ?? 'none', limit);
  return useQuery({ queryKey: key,
    queryFn: async ({ signal }) => {
      const cached = client.getQueryData<{ data: PersonalRecommendations }>(key);
      let response = await recommendationsApi.personal(limit, signal);
      // An initial AI outage otherwise becomes a successful fallback cached for the entire freshness window.
      // Retry once only; an existing personalized response is kept immediately on background refresh instead.
      if (!cached?.data.isPersonalized && response.data.fallbackReason === 'AI_UNAVAILABLE' && !signal.aborted) {
        try { response = await recommendationsApi.personal(limit, signal); }
        catch (error) { if (signal.aborted || isAbortError(error)) throw error; }
      }
      const consent = userId
        ? client.getQueryData<{ data: RecommendationPreferences }>(queryKeys.recommendations.preferences(userId))
        : undefined;
      // Preserve usable personalized picks across a transient model outage only for the same signed-in,
      // explicitly consenting customer. OFF and insufficient-history responses intentionally replace them.
      return resolvePersonalResponse(response, cached, consent?.data.personalizationEnabled === true);
    }, enabled: Boolean(userId), ...privatePolicy });
}

export function resolvePersonalResponse(
  response: { data: PersonalRecommendations },
  cached: { data: PersonalRecommendations } | undefined,
  consentConfirmed: boolean,
) {
  if (response.data.fallbackReason === 'AI_UNAVAILABLE' && cached?.data.isPersonalized && consentConfirmed) {
    return { ...cached, data: { ...cached.data, fallbackReason: 'AI_UNAVAILABLE' } };
  }
  return response;
}

export function useRecommendationPreferences(userId: string | undefined) {
  return useQuery({ queryKey: queryKeys.recommendations.preferences(userId ?? 'none'),
    queryFn: ({ signal }) => recommendationsApi.preferences(signal), enabled: Boolean(userId), ...privatePolicy });
}

export function useRecentlyViewed(userId: string | undefined, limit = 8, consented = true) {
  return useQuery({ queryKey: queryKeys.recommendations.recentlyViewed(userId ?? 'none'),
    queryFn: ({ signal }) => recommendationsApi.recentlyViewed(limit, signal), enabled: Boolean(userId) && consented, ...privatePolicy });
}

function invalidatePersonal(client: ReturnType<typeof useQueryClient>, userId: string) {
  for (const key of queryKeys.recommendations.userScoped(userId)) void client.invalidateQueries({ queryKey: key });
}

function invalidatePersonalWhileConsented(client: ReturnType<typeof useQueryClient>, userId: string) {
  const preferences = client.getQueryData<{ data: RecommendationPreferences }>(queryKeys.recommendations.preferences(userId));
  if (preferences?.data.personalizationEnabled) invalidatePersonal(client, userId);
}

async function discardPersonalResults(client: ReturnType<typeof useQueryClient>, userId: string) {
  const key = ['recommendations', 'personal', userId] as const;
  await client.cancelQueries({ queryKey: key });
  client.removeQueries({ queryKey: key });
}

export function useSetRecommendationPreferences(userId: string) {
  const client = useQueryClient();
  const preferenceKey = queryKeys.recommendations.preferences(userId);
  return useMutation({
    mutationFn: (enabled: boolean) => recommendationsApi.setPreferences(enabled),
    onMutate: async enabled => {
      const previous = client.getQueryData<{ data: RecommendationPreferences }>(preferenceKey);
      if (previous) client.setQueryData(preferenceKey, {
        ...previous, data: { ...previous.data, personalizationEnabled: enabled },
      });
      // Trigger cancellation before yielding: the optimistic preference and dependent section state update now,
      // while any older request is prevented from overwriting that state before the mutation is sent.
      const cancellations = [client.cancelQueries({ queryKey: preferenceKey })];
      if (!enabled) {
        const [personalKey, recentlyViewedKey] = queryKeys.recommendations.userScoped(userId);
        cancellations.push(...[
          client.cancelQueries({ queryKey: personalKey }),
          client.cancelQueries({ queryKey: recentlyViewedKey }),
        ]);
      }
      await Promise.all(cancellations);
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (!client.getQueryData(preferenceKey)) return;
      if (context?.previous) client.setQueryData(preferenceKey, context.previous);
      invalidatePersonalWhileConsented(client, userId);
    },
    onSuccess: async response => {
      // Logout/account changes clear the QueryClient; never repopulate private preference data afterward.
      if (!client.getQueryData(preferenceKey)) return;
      client.setQueryData<{ data: RecommendationPreferences }>(preferenceKey, response);
      if (!response.data.personalizationEnabled) {
        forgetRecordedProductViews(userId);
        const [personalKey, recentlyViewedKey] = queryKeys.recommendations.userScoped(userId);
        await Promise.all([
          client.cancelQueries({ queryKey: personalKey }),
          client.cancelQueries({ queryKey: recentlyViewedKey }),
        ]);
        client.removeQueries({ queryKey: personalKey });
        client.removeQueries({ queryKey: recentlyViewedKey });
      }
      invalidatePersonal(client, userId);
    },
  });
}

export function useClearRecentlyViewed(userId: string) {
  const client = useQueryClient();
  const recentKey = queryKeys.recommendations.recentlyViewed(userId);
  return useMutation({
    mutationFn: () => recommendationsApi.clearRecentlyViewed(),
    onMutate: async () => {
      await Promise.all([
        client.cancelQueries({ queryKey: recentKey }),
        client.cancelQueries({ queryKey: ['recommendations', 'personal', userId] }),
      ]);
      const previous = client.getQueriesData({ queryKey: recentKey });
      for (const [key, value] of previous) {
        if (value && typeof value === 'object' && 'data' in value) {
          const data = value.data as { personalizationEnabled: boolean; items: ProductSummary[] };
          client.setQueryData(key, { ...value, data: { ...data, items: [] } });
        }
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      const consent = client.getQueryData<{ data: RecommendationPreferences }>(queryKeys.recommendations.preferences(userId));
      if (consent?.data.personalizationEnabled) {
        for (const [key, value] of context?.previous ?? []) client.setQueryData(key, value);
      }
    },
    onSuccess: async () => {
      forgetRecordedProductViews(userId);
      await discardPersonalResults(client, userId);
    },
    onSettled: () => invalidatePersonalWhileConsented(client, userId),
  });
}

export function useRemoveRecentlyViewed(userId: string) {
  const client = useQueryClient();
  const key = queryKeys.recommendations.recentlyViewed(userId);
  return useMutation({
    mutationFn: (productId: string) => recommendationsApi.removeRecentlyViewed(productId),
    onMutate: async productId => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<{ data: { personalizationEnabled: boolean; items: ProductSummary[] } }>(key);
      const productIndex = previous?.data.items.findIndex(product => product.id === productId) ?? -1;
      const product = productIndex >= 0 ? previous?.data.items[productIndex] : undefined;
      if (previous) client.setQueryData(key, { ...previous, data: { ...previous.data,
        items: previous.data.items.filter(product => product.id !== productId) } });
      return { previous, product, productIndex };
    },
    onError: (_error, _productId, context) => {
      const consent = client.getQueryData<{ data: RecommendationPreferences }>(queryKeys.recommendations.preferences(userId));
      if (context?.product && consent?.data.personalizationEnabled) {
        const current = client.getQueryData<typeof context.previous>(key);
        if (current && !current.data.items.some(product => product.id === context.product?.id)) {
          const items = [...current.data.items];
          items.splice(Math.min(Math.max(context.productIndex, 0), items.length), 0, context.product);
          client.setQueryData(key, { ...current, data: { ...current.data, items } });
        } else if (!current && context.previous) client.setQueryData(key, context.previous);
      }
    },
    onSuccess: async (_data, productId) => {
      forgetRecordedProductViews(userId, productId);
      await discardPersonalResults(client, userId);
    },
    onSettled: () => invalidatePersonalWhileConsented(client, userId),
  });
}

/**
 * Records one meaningful product-detail view per product per 30-minute window, only for a signed-in customer who has
 * turned personalization on (the server re-checks consent). Failures are ignored: tracking never affects the page.
 */
export function useRecordProductView(productId: string | undefined, userId: string | undefined, personalizationEnabled: boolean) {
  const client = useQueryClient();
  const latestView = useRef({ productId, userId, personalizationEnabled });
  const viewGeneration = useRef(0);
  // The last view this mounted page sent. Re-renders and session-restore flicker reuse it; a genuine revisit (a new
  // mount, or navigating back to this product) does not, so it still refreshes the history order.
  const lastSent = useRef<string | null>(null);
  if (latestView.current.productId !== productId || latestView.current.userId !== userId ||
      latestView.current.personalizationEnabled !== personalizationEnabled) viewGeneration.current += 1;
  latestView.current = { productId, userId, personalizationEnabled };
  useEffect(() => {
    if (userId && !personalizationEnabled) {
      // Opt-out erases this customer's server history. Drop local dedupe too,
      // so a later opt-in can record a genuinely new view in the same window.
      forgetRecordedProductViews(userId);
    }
    if (!productId || !userId || !personalizationEnabled) {
      return;
    }
    const bucket = Math.floor(Date.now() / 1_800_000);
    const idempotencyKey = `view:${productId}:${bucket}`;
    // Account identity scopes only the in-memory set; it is never sent in the
    // idempotency key or interaction payload.
    const recorded = recordedViewsFor(userId, bucket);
    const sent = `${userId}:${idempotencyKey}`;
    const generation = viewGeneration.current;
    const input = { productId, eventType: 'VIEW' as const, surface: 'product_detail', idempotencyKey };
    if (recorded.has(idempotencyKey)) {
      if (lastSent.current === sent) return;
      lastSent.current = sent;
      // Same window, same key: the server adds no profile weight and only moves the history entry to the top.
      recommendationsApi.recordInteraction(input).then(result => {
        const latest = latestView.current;
        if (result.data.historyUpdated && viewGeneration.current === generation && latest.userId === userId && latest.personalizationEnabled) {
          void client.invalidateQueries({ queryKey: queryKeys.recommendations.recentlyViewed(userId) });
        }
      }, () => undefined);
      return;
    }
    recorded.add(idempotencyKey);
    lastSent.current = sent;
    // Retry once with the same idempotency key: a lost response must not create
    // duplicate activity, while a transient failure should not drop the view.
    void recommendationsApi.recordInteraction(input).then(result => {
      const latest = latestView.current;
      if (result.data.recorded && viewGeneration.current === generation && latest.userId === userId &&
          latest.productId === productId && latest.personalizationEnabled) {
        void client.invalidateQueries({ queryKey: ['recommendations', 'personal', userId] });
        void client.invalidateQueries({ queryKey: queryKeys.recommendations.recentlyViewed(userId) });
      }
    }, async () => {
      const latest = latestView.current;
      if (viewGeneration.current !== generation || latest.userId !== userId || latest.productId !== productId || !latest.personalizationEnabled) return;
      try {
        const result = await recommendationsApi.recordInteraction(input);
        const current = latestView.current;
        if (result.data.recorded && viewGeneration.current === generation && current.userId === userId &&
            current.productId === productId && current.personalizationEnabled) {
          void client.invalidateQueries({ queryKey: ['recommendations', 'personal', userId] });
          void client.invalidateQueries({ queryKey: queryKeys.recommendations.recentlyViewed(userId) });
        }
      } catch { /* Best-effort tracking never affects product navigation. */ }
    });
  }, [client, personalizationEnabled, productId, userId]);
}

export function recordRecommendationClick(productId: string, surface: string) {
  const idempotencyKey = `click:${productId}:${Date.now().toString(36)}`;
  recommendationsApi.recordInteraction({ productId, eventType: 'RECOMMENDATION_CLICK', surface, idempotencyKey }).catch(() => undefined);
}
