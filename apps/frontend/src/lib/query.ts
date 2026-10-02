import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { searchParams, type SearchState } from '@/features/search/searchState';

export const cachePolicy = {
  reference: { staleTime: 10 * 60_000, gcTime: 30 * 60_000 },
  products: { staleTime: 60_000, gcTime: 5 * 60_000 },
  search: { staleTime: 30_000, gcTime: 2 * 60_000 },
  suggestions: { staleTime: 10_000, gcTime: 60_000 },
} as const;

// StrictMode remounts effects in development. Keeping the in-flight public read
// allows React Query to share it instead of cancelling and starting duplicate SQL.
export const catalogSignal = (context: { signal: AbortSignal }) => import.meta.env.DEV ? undefined : context.signal;

export const queryKeys = {
  cart: { all: ['cart'] as const, current: (userId: string) => ['cart', 'current', userId] as const,
    guest: (items: string) => ['cart', 'guest', items] as const },
  products: {
    all: ['products'] as const,
    list: (params: string) => ['products', 'list', params] as const,
    detail: (slug: string) => ['products', 'detail', slug] as const,
    deals: (params: string) => ['products', 'deals', params] as const,
    reviews: (slug: string, page: number) => ['products', 'reviews', slug, page] as const,
    myReview: (slug: string) => ['products', 'reviews', slug, 'me'] as const,
    myReviews: (page: number, pageSize: number) => ['reviews', 'me', page, pageSize] as const,
  },
  categories: { all: ['categories'] as const, detail: (slug: string) => ['categories', 'detail', slug] as const },
  brands: { all: ['brands'] as const, detail: (slug: string) => ['brands', 'detail', slug] as const },
  search: {
    all: ['search'] as const,
    products: (state: SearchState) => ['search', 'products', searchParams(state).toString()] as const,
    suggestions: (query: string, limit: number) => ['search', 'suggestions', query.trim().replace(/\s+/g, ' '), limit] as const,
  },
} as const;

export function shouldRetry(failureCount: number, error: unknown) {
  if (failureCount >= 1 || (error instanceof DOMException && error.name === 'AbortError')) return false;
  if (error instanceof ApiError) return error.status === 0 || error.status >= 500;
  return false;
}

export function createQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      retryDelay: attempt => Math.min(300 * 2 ** attempt, 2_000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
    },
    mutations: { retry: false },
  } });
}

export const queryClient = createQueryClient();
