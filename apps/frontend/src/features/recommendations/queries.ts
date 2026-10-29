import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogSignal, queryKeys } from '@/lib/query';
import { recommendationsApi } from './api';
import type { RecommendationPreferences } from './types';

/** Recommendations are optional enhancements: short freshness, no retry storm, never a page-level failure. */
const recommendationPolicy = { staleTime: 60_000, gcTime: 5 * 60_000, retry: 1 } as const;
const privatePolicy = { staleTime: 30_000, gcTime: 2 * 60_000, retry: false } as const;

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
  return useQuery({ queryKey: queryKeys.recommendations.personal(userId ?? 'none', limit),
    queryFn: ({ signal }) => recommendationsApi.personal(limit, signal), enabled: Boolean(userId), ...privatePolicy });
}

export function useRecommendationPreferences(userId: string | undefined) {
  return useQuery({ queryKey: queryKeys.recommendations.preferences(userId ?? 'none'),
    queryFn: ({ signal }) => recommendationsApi.preferences(signal), enabled: Boolean(userId), ...privatePolicy });
}

export function useRecentlyViewed(userId: string | undefined, limit = 8) {
  return useQuery({ queryKey: queryKeys.recommendations.recentlyViewed(userId ?? 'none'),
    queryFn: ({ signal }) => recommendationsApi.recentlyViewed(limit, signal), enabled: Boolean(userId), ...privatePolicy });
}

function invalidatePersonal(client: ReturnType<typeof useQueryClient>, userId: string) {
  for (const key of queryKeys.recommendations.userScoped(userId)) void client.invalidateQueries({ queryKey: key });
}

export function useSetRecommendationPreferences(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => recommendationsApi.setPreferences(enabled),
    onSuccess: response => {
      client.setQueryData<{ data: RecommendationPreferences }>(queryKeys.recommendations.preferences(userId), response);
      invalidatePersonal(client, userId);
    },
  });
}

export function useClearRecentlyViewed(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => recommendationsApi.clearRecentlyViewed(),
    onSuccess: () => invalidatePersonal(client, userId),
  });
}

/**
 * Records one meaningful product-detail view per product per 30-minute window, only for a signed-in customer who has
 * turned personalization on (the server re-checks consent). Failures are ignored: tracking never affects the page.
 */
export function useRecordProductView(productId: string | undefined, userId: string | undefined, personalizationEnabled: boolean) {
  const client = useQueryClient();
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    if (!productId || !userId || !personalizationEnabled) return;
    const bucket = Math.floor(Date.now() / 1_800_000);
    const idempotencyKey = `view:${productId}:${bucket}`;
    if (recorded.current.has(idempotencyKey)) return;
    recorded.current.add(idempotencyKey);
    recommendationsApi.recordInteraction({ productId, eventType: 'VIEW', surface: 'product_detail', idempotencyKey })
      .then(result => { if (result.data.recorded) invalidatePersonal(client, userId); }, () => undefined);
  }, [client, personalizationEnabled, productId, userId]);
}

export function recordRecommendationClick(productId: string, surface: string) {
  const idempotencyKey = `click:${productId}:${Date.now().toString(36)}`;
  recommendationsApi.recordInteraction({ productId, eventType: 'RECOMMENDATION_CLICK', surface, idempotencyKey }).catch(() => undefined);
}
