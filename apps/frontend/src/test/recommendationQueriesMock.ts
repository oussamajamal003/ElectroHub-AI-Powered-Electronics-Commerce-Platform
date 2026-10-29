import { vi } from 'vitest';

/**
 * Module stand-in for '@/features/recommendations/queries' in page tests that are not about recommendations: every
 * rail resolves to "nothing to show", so pages render exactly their pre-04.4 content and make no extra requests.
 * Usage: vi.mock('@/features/recommendations/queries', () => import('@/test/recommendationQueriesMock')).
 */
const idle = () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() });
const mutation = () => ({ mutate: vi.fn(), isPending: false });

export const useProductRecommendations = vi.fn(idle);
export const usePopularRecommendations = vi.fn(idle);
export const useCartRecommendations = vi.fn(idle);
export const usePersonalRecommendations = vi.fn(idle);
export const useRecommendationPreferences = vi.fn(idle);
export const useRecentlyViewed = vi.fn(idle);
export const useSetRecommendationPreferences = vi.fn(mutation);
export const useClearRecentlyViewed = vi.fn(mutation);
export const useRecordProductView = vi.fn();
export const recordRecommendationClick = vi.fn();
