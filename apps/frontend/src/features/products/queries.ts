import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { cachePolicy, queryKeys } from '@/lib/query';
import type { Brand, Category, ProductCollection, ProductDetail, ProductResponse, ProductSummary } from './types';

export function useProducts(params: URLSearchParams, enabled = true) {
  const serialized = params.toString();
  return useQuery({ queryKey: queryKeys.products.list(serialized),
    queryFn: ({ signal }) => apiClient<ProductCollection<ProductSummary>>(`/api/products?${serialized}`, { signal }),
    enabled, ...cachePolicy.products });
}

export function useProduct(slug: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.products.detail(slug),
    queryFn: ({ signal }) => apiClient<ProductResponse<ProductDetail>>(`/api/products/${encodeURIComponent(slug)}`, { signal }),
    enabled: enabled && Boolean(slug), ...cachePolicy.products });
}

export function useCategory(slug: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.categories.detail(slug),
    queryFn: ({ signal }) => apiClient<ProductResponse<Category>>(`/api/categories/${encodeURIComponent(slug)}`, { signal }),
    enabled: enabled && Boolean(slug), ...cachePolicy.reference });
}

export function useBrand(slug: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.brands.detail(slug),
    queryFn: ({ signal }) => apiClient<ProductResponse<Brand>>(`/api/brands/${encodeURIComponent(slug)}`, { signal }),
    enabled: enabled && Boolean(slug), ...cachePolicy.reference });
}
