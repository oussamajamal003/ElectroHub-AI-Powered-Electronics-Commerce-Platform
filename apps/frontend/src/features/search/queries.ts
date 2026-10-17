import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { cachePolicy, catalogSignal, queryKeys } from '@/lib/query';
import type { Brand, Category } from '@/features/products/types';
import { fetchCollection, fetchSearch, fetchSuggestions } from './api';
import { normalizeQuery, type SearchState } from './searchState';

// keepPreviousData: the current page stays rendered (and its pagination stays mounted) until the next page arrives,
// so the page never collapses to a skeleton and the browser never clamps the scroll position mid-navigation.
export function useSearchResults(state: SearchState, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.search.products(state), queryFn: context => fetchSearch(state, catalogSignal(context)),
    enabled, placeholderData: keepPreviousData, ...cachePolicy.search });
}

export function useCategories(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.categories.all, queryFn: context => fetchCollection<Category>('categories', catalogSignal(context)),
    enabled, ...cachePolicy.reference });
}

export function useBrands(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.brands.all, queryFn: context => fetchCollection<Brand>('brands', catalogSignal(context)),
    enabled, ...cachePolicy.reference });
}

export function useSearchSuggestions(value: string, enabled: boolean) {
  const query = normalizeQuery(value);
  return useQuery({ queryKey: queryKeys.search.suggestions(query, 8),
    queryFn: ({ signal }) => fetchSuggestions(query, signal),
    enabled: enabled && query.length >= 2 && query.length <= 120, ...cachePolicy.suggestions, retry: false });
}
