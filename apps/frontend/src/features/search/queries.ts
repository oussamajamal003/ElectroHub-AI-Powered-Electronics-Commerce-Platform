import { useQuery } from '@tanstack/react-query';
import { cachePolicy, queryKeys } from '@/lib/query';
import type { Brand, Category } from '@/features/products/types';
import { fetchCollection, fetchSearch, fetchSuggestions } from './api';
import { normalizeQuery, type SearchState } from './searchState';

export function useSearchResults(state: SearchState, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.search.products(state), queryFn: ({ signal }) => fetchSearch(state, signal),
    enabled, ...cachePolicy.search });
}

export function useCategories(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.categories.all, queryFn: ({ signal }) => fetchCollection<Category>('categories', signal),
    enabled, ...cachePolicy.reference });
}

export function useBrands(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.brands.all, queryFn: ({ signal }) => fetchCollection<Brand>('brands', signal),
    enabled, ...cachePolicy.reference });
}

export function useSearchSuggestions(value: string, enabled: boolean) {
  const query = normalizeQuery(value);
  return useQuery({ queryKey: queryKeys.search.suggestions(query, 8),
    queryFn: ({ signal }) => fetchSuggestions(query, signal),
    enabled: enabled && query.length >= 2 && query.length <= 120, ...cachePolicy.suggestions, retry: false });
}
