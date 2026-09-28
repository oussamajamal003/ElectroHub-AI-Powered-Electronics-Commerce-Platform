import { apiClient } from '@/lib/api';
import type { ProductSummary, ProductCollection, Category, Brand } from '@/features/products/types';
import { searchParams, type SearchState } from './searchState';

export interface SearchResults extends ProductCollection<ProductSummary> { meta: ProductCollection<ProductSummary>['meta'] & { totalPages: number } }
export interface Suggestion { id: string; type: 'PRODUCT' | 'CATEGORY' | 'BRAND'; label: string; slug: string }
export const fetchSearch = (state: SearchState, signal: AbortSignal) =>
  apiClient<SearchResults>(`/api/search/products?${searchParams(state)}`, { signal });
export const fetchSuggestions = (q: string, signal: AbortSignal) =>
  apiClient<{ data: Suggestion[] }>(`/api/search/suggestions?${new URLSearchParams({ q, limit: '8' })}`, { signal });
export async function fetchFilters(signal: AbortSignal) {
  const collect = async <Metadata,>(resource: string) => {
    const data: Metadata[] = [];
    for (let page = 1; page <= 1000; page++) {
      const response = await apiClient<ProductCollection<Metadata>>(`/api/${resource}?page=${page}&pageSize=100`, { signal });
      data.push(...response.data);
      if (data.length >= response.meta.total || !response.data.length) break;
    }
    return data;
  };
  const [categories, brands] = await Promise.all([collect<Category>('categories'), collect<Brand>('brands')]);
  return { categories, brands };
}
export function productCardProps(product: ProductSummary) {
  return { id: product.id, title: product.name, category: product.category.name,
    price: Number(product.price), imageUrl: product.primaryImage?.url ?? '', showActions: false, square: true };
}
