import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { RecommendationSection } from '@/features/recommendations/types';
import { queryString } from '../shared/api';

/** Task 05.2 administrator recommendation management, mirroring apps/backend/src/routes/admin-recommendations.routes.ts. */
export type RecommendationSurfaceKey = 'home' | 'product_detail' | 'cart';
export type RecommendationSectionMode = 'POPULAR_PRODUCTS' | 'RECOMMENDED_FOR_YOU' | 'SIMILAR_PRODUCTS' | 'YOU_MAY_ALSO_LIKE' | 'FREQUENTLY_BOUGHT_TOGETHER';
export type RecommendationPeriod = '7d' | '30d' | '90d';
export type PinState = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'PAUSED' | 'INELIGIBLE';

export interface SectionConfig {
  surface: RecommendationSurfaceKey; mode: RecommendationSectionMode; enabled: boolean; itemLimit: number; defaultLimit: number;
  maxLimit: number; version: number; updatedAt: string | null; configured: boolean;
}

export interface OverviewRow {
  surface: RecommendationSurfaceKey; mode: RecommendationSectionMode; strategy: string; impressions: number; clicks: number;
  ctr: number | null; fallback: boolean;
}
export interface RecommendationOverview {
  period: RecommendationPeriod; since: string;
  totals: { impressions: number; clicks: number; ctr: number | null; fallbackImpressions: number; fallbackShare: number | null };
  breakdown: OverviewRow[];
}

export interface FeaturedPin {
  id: string; productId: string; surface: RecommendationSurfaceKey; position: number; startsAt: string | null; endsAt: string | null;
  enabled: boolean; version: number; state: PinState; eligible: boolean; ineligibleReasons?: string[];
  product: { id: string; name: string; slug: string; sku: string } | null;
}

export interface PreviewResponse { recorded: false; context: unknown; sections: RecommendationSection[] }

export interface PreviewParams { surface: RecommendationSurfaceKey; productId?: string; cartProductIds?: string[]; limit: number }

export const recommendationKeys = {
  all: ['admin', 'recommendations'] as const,
  overview: (period: string, surface?: string) => ['admin', 'recommendations', 'overview', period, surface ?? 'all'] as const,
  configurations: ['admin', 'recommendations', 'configurations'] as const,
  featured: (surface?: string) => ['admin', 'recommendations', 'featured', surface ?? 'all'] as const,
  preview: (params: string) => ['admin', 'recommendations', 'preview', params] as const,
};

export function useRecommendationOverview(period: RecommendationPeriod, surface?: RecommendationSurfaceKey) {
  return useQuery({
    queryKey: recommendationKeys.overview(period, surface),
    queryFn: async ({ signal }) => (await apiClient<{ data: RecommendationOverview }>(
      `/api/admin/recommendations/overview${queryString({ period, surface })}`, { signal })).data,
  });
}

export function useRecommendationConfigurations() {
  return useQuery({
    queryKey: recommendationKeys.configurations,
    queryFn: async ({ signal }) => (await apiClient<{ data: SectionConfig[] }>('/api/admin/recommendations/configurations', { signal })).data,
  });
}

export function useFeaturedPins(surface?: RecommendationSurfaceKey) {
  return useQuery({
    queryKey: recommendationKeys.featured(surface),
    queryFn: async ({ signal }) => (await apiClient<{ data: FeaturedPin[]; meta: { maxPerSurface: number } }>(
      `/api/admin/recommendations/featured${queryString({ surface })}`, { signal })),
  });
}

/** Preview is read-only on the server (no event, token or history write), so it is safe to refetch on demand. */
export function useRecommendationPreview(params: PreviewParams | null) {
  const key = params ? queryString({ surface: params.surface, productId: params.productId,
    cartProductIds: params.cartProductIds?.join(','), limit: params.limit }) : '';
  return useQuery({
    queryKey: recommendationKeys.preview(key),
    enabled: params !== null,
    retry: false,
    queryFn: async ({ signal }) => (await apiClient<{ data: PreviewResponse }>(`/api/admin/recommendations/preview${key}`, { signal })).data,
  });
}

export function useRecommendationMutations() {
  const client = useQueryClient();
  // Every write changes what the storefront shows, so the admin views and any open previews are refetched together.
  const settle = () => void client.invalidateQueries({ queryKey: recommendationKeys.all });

  const saveSection = useMutation({
    mutationFn: ({ surface, mode, ...body }: { surface: RecommendationSurfaceKey; mode: RecommendationSectionMode; enabled?: boolean; itemLimit?: number; expectedVersion: number }) =>
      apiClient<{ data: SectionConfig }>(`/api/admin/recommendations/configurations/${surface}/${mode}`, { method: 'PATCH', data: body }),
    onSettled: settle,
  });

  const createPin = useMutation({
    mutationFn: (body: { productId: string; surface: RecommendationSurfaceKey; position: number; startsAt: string | null; endsAt: string | null; enabled: boolean }) =>
      apiClient<{ data: FeaturedPin }>('/api/admin/recommendations/featured', { method: 'POST', data: body }),
    onSettled: settle,
  });

  const updatePin = useMutation({
    mutationFn: ({ id, ...body }: { id: string; expectedVersion: number; position?: number; enabled?: boolean; startsAt?: string | null; endsAt?: string | null }) =>
      apiClient<{ data: FeaturedPin }>(`/api/admin/recommendations/featured/${encodeURIComponent(id)}`, { method: 'PATCH', data: body }),
    onSettled: settle,
  });

  const deletePin = useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
      apiClient<void>(`/api/admin/recommendations/featured/${encodeURIComponent(id)}${queryString({ expectedVersion })}`, { method: 'DELETE' }),
    onSettled: settle,
  });

  return { saveSection, createPin, updatePin, deletePin };
}
