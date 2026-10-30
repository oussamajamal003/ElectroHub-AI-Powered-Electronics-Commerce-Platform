import { apiClient } from '@/lib/api';
import type {
  PersonalRecommendations, ProductRecommendations, RecentlyViewed, RecommendationPreferences, RecommendationSection,
} from './types';

type Envelope<T> = { data: T };

export const recommendationsApi = {
  product: (slug: string, limit: number, signal?: AbortSignal) =>
    apiClient<Envelope<ProductRecommendations>>(`/api/products/${encodeURIComponent(slug)}/recommendations?limit=${limit}`, { signal }),
  popular: (limit: number, signal?: AbortSignal) =>
    apiClient<Envelope<RecommendationSection>>(`/api/recommendations/popular?limit=${limit}`, { signal }),
  personal: (limit: number, signal?: AbortSignal) =>
    apiClient<Envelope<PersonalRecommendations>>(`/api/me/recommendations?limit=${limit}`, { signal }),
  // POST keeps cart contents out of URLs; the server treats the ids as context only.
  cart: (productIds: string[], limit: number, signal?: AbortSignal) =>
    apiClient<Envelope<RecommendationSection>>('/api/recommendations/cart', { method: 'POST', data: { productIds, limit }, signal }),
  preferences: (signal?: AbortSignal) => apiClient<Envelope<RecommendationPreferences>>('/api/me/recommendation-preferences', { signal }),
  setPreferences: (personalizationEnabled: boolean) =>
    apiClient<Envelope<RecommendationPreferences>>('/api/me/recommendation-preferences', { method: 'PATCH', data: { personalizationEnabled } }),
  recentlyViewed: (limit: number, signal?: AbortSignal) =>
    apiClient<Envelope<RecentlyViewed>>(`/api/me/recently-viewed?limit=${limit}`, { signal }),
  removeRecentlyViewed: (productId: string) =>
    apiClient<void>(`/api/me/recently-viewed/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  clearRecentlyViewed: () => apiClient<void>('/api/me/recently-viewed', { method: 'DELETE' }),
  recordInteraction: (input: { productId: string; eventType: 'VIEW' | 'RECOMMENDATION_CLICK'; surface: string; idempotencyKey: string }) =>
    apiClient<Envelope<{ recorded: boolean; reason: string | null; historyUpdated?: boolean }>>('/api/product-interactions', { method: 'POST', data: input }),
};

/**
 * Non-personal attribution events. `keepalive` lets a click event finish after navigation; failures are ignored on
 * purpose (telemetry must never block or break shopping), and no credentials are sent.
 */
export function sendRecommendationEvents(token: string, events: { productId: string; type: 'IMPRESSION' | 'CLICK' }[]) {
  if (events.length === 0 || typeof fetch !== 'function') return;
  try {
    void fetch('/api/recommendations/events', {
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, events }),
    }).catch(() => undefined);
  } catch { /* Telemetry is best effort. */ }
}
