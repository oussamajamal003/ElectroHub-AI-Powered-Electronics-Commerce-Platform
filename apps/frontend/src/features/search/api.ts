import { apiClient } from '@/lib/api';
import type { ProductSummary, ProductCollection, Category, Brand } from '@/features/products/types';
import { searchParams, type SearchState } from './searchState';

export interface SearchResults extends ProductCollection<ProductSummary> { meta: ProductCollection<ProductSummary>['meta'] & { totalPages: number } }
export interface Suggestion { id: string; type: 'PRODUCT' | 'CATEGORY' | 'BRAND'; label: string; slug: string }
export const fetchSearch = (state: SearchState, signal?: AbortSignal) =>
  apiClient<SearchResults>(`/api/search/products?${searchParams(state)}`, { signal });
export const fetchSuggestions = (q: string, signal: AbortSignal) =>
  apiClient<{ data: Suggestion[] }>(`/api/search/suggestions?${new URLSearchParams({ q, limit: '8' })}`, { signal });
export async function fetchCollection<Metadata extends Category | Brand>(resource: 'categories' | 'brands', signal?: AbortSignal) {
  const data: Metadata[] = [];
  for (let page = 1; page <= 1000; page++) {
    const response = await apiClient<ProductCollection<Metadata>>(`/api/${resource}?page=${page}&pageSize=100`, { signal });
    data.push(...response.data);
    if (data.length >= response.meta.total || !response.data.length) break;
  }
  return data;
}
export function productCardProps(product: ProductSummary) {
  return { id: product.id, title: product.name, category: product.category.name,
    description: product.description ?? undefined,
    price: Number(product.price), compareAtPrice: product.compareAtPrice === null ? undefined : Number(product.compareAtPrice),
    discountPercent: product.discountPercent ?? undefined,
    rating: product.averageRating == null ? null : Number(product.averageRating), reviewCount: product.reviewCount ?? 0,
    availability: product.availability, href: `/products/${encodeURIComponent(product.slug)}`,
    imageUrl: product.primaryImage?.url ?? '', secondaryImageUrl: product.secondaryImage?.url,
    showActions: true, square: true };
}
