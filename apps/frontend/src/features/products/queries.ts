import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { cachePolicy, catalogSignal, queryKeys } from '@/lib/query';
import type { Brand, Category, MyReviewItem, ProductCollection, ProductDetail, ProductResponse, ProductSummary, Review, ReviewCollection, ReviewMutationResponse } from './types';
import type { SearchResults } from '@/features/search/api';

export function useProducts(params: URLSearchParams, enabled = true) {
  const serialized = params.toString();
  return useQuery({ queryKey: queryKeys.products.list(serialized),
    queryFn: context => apiClient<ProductCollection<ProductSummary>>(`/api/products?${serialized}`, { signal: catalogSignal(context) }),
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

export function useDeals(pageSize = 6) {
  const params = new URLSearchParams({ pageSize: String(pageSize) }).toString();
  return useQuery({ queryKey: queryKeys.products.deals(params),
    queryFn: context => apiClient<ProductCollection<ProductSummary>>(`/api/products/deals?${params}`, { signal: catalogSignal(context) }),
    ...cachePolicy.products });
}

export function useReviews(slug: string, page: number) {
  return useQuery({ queryKey: queryKeys.products.reviews(slug, page),
    queryFn: ({ signal }) => apiClient<ReviewCollection>(`/api/products/${encodeURIComponent(slug)}/reviews?page=${page}`, { signal }),
    enabled: Boolean(slug), ...cachePolicy.products });
}

export function useMyReviews(enabled: boolean, page = 1, pageSize = 20) {
  return useQuery({ queryKey: queryKeys.products.myReviews(page, pageSize),
    queryFn: ({ signal }) => apiClient<ProductCollection<MyReviewItem> & { meta: { totalPages: number } }>(`/api/reviews/me?page=${page}&pageSize=${pageSize}`, { signal }),
    enabled, ...cachePolicy.products, retry: false });
}

export function useMyReview(slug: string, enabled: boolean) {
  return useQuery({ queryKey: queryKeys.products.myReview(slug),
    queryFn: ({ signal }) => apiClient<ProductResponse<Review | null>>(`/api/products/${encodeURIComponent(slug)}/reviews/me`, { signal }),
    enabled: enabled && Boolean(slug), ...cachePolicy.products, retry: false });
}

export function useReviewMutation(slug: string) {
  const client = useQueryClient();
  const path = `/api/products/${encodeURIComponent(slug)}/reviews`;
  return useMutation({
    mutationFn: (input: { method: 'POST' | 'PATCH' | 'DELETE'; rating?: number; body?: string }) =>
      apiClient<ReviewMutationResponse | void>(input.method === 'POST' ? path : `${path}/me`,
        { method: input.method, data: input.method === 'DELETE' ? undefined : { rating: input.rating, body: input.body } }),
    onSuccess: (response, input) => {
      const previousReview = client.getQueryData<ProductResponse<Review | null>>(queryKeys.products.myReview(slug))?.data;
      const review = response?.data;
      const summary = response?.summary;
      client.setQueryData<ProductResponse<Review | null>>(queryKeys.products.myReview(slug), { data: input.method === 'DELETE' ? null : review ?? null });

      const reviewQueries = client.getQueriesData<ReviewCollection>({ queryKey: ['products', 'reviews', slug] });
      for (const [key, cached] of reviewQueries) {
        if (!cached || key[3] === 'me') continue;
        const isFirstPage = Number(key[3]) === 1;
        let data = cached.data.filter(item => item.id !== (review?.id ?? previousReview?.id));
        if (input.method !== 'DELETE' && review && isFirstPage) data = [review, ...data].slice(0, cached.meta.pageSize);
        if (input.method === 'PATCH' && review) data = cached.data.map(item => item.id === review.id ? review : item);
        const delta = input.method === 'POST' ? 1 : input.method === 'DELETE' ? -1 : 0;
        client.setQueryData<ReviewCollection>(key, { ...cached, data,
          summary: summary ?? cached.summary,
          meta: { ...cached.meta, total: Math.max(0, cached.meta.total + delta),
            totalPages: Math.ceil(Math.max(0, cached.meta.total + delta) / cached.meta.pageSize) } });
      }

      const applySummary = (nextSummary: NonNullable<typeof summary>) => {
        client.setQueryData<ProductResponse<ProductDetail>>(queryKeys.products.detail(slug), current => current && ({
          ...current, data: { ...current.data, ...nextSummary },
        }));
        const updateRows = <T extends { data: ProductSummary[] }>(current: T | undefined): T | undefined => current && ({
          ...current, data: current.data.map(item => item.slug === slug ? { ...item, ...nextSummary } : item),
        });
        for (const [key, value] of client.getQueriesData<ProductCollection<ProductSummary>>({ queryKey: queryKeys.products.all })) {
          if (key[1] === 'list' || key[1] === 'deals') client.setQueryData(key, updateRows(value));
        }
        client.setQueriesData<SearchResults>({ queryKey: ['search', 'products'] }, updateRows);
      };

      void client.invalidateQueries({ queryKey: ['products', 'reviews', slug], refetchType: 'none' });
      if (input.method === 'DELETE') {
        void client.fetchQuery({
          queryKey: queryKeys.products.reviews(slug, 1),
          queryFn: ({ signal }) => apiClient<ReviewCollection>(`${path}?page=1`, { signal }),
          staleTime: 0,
        }).then(freshReviews => { if (freshReviews.summary) applySummary(freshReviews.summary); }, () => undefined);
      }
      if (summary) applySummary(summary);
      void client.invalidateQueries({ queryKey: ['reviews', 'me'] });
      if (input.method === 'DELETE') {
        void client.invalidateQueries({ queryKey: ['products', 'list'] });
        void client.invalidateQueries({ queryKey: ['products', 'deals'] });
        void client.invalidateQueries({ queryKey: ['search', 'products'] });
      } else {
        void client.invalidateQueries({ queryKey: ['products', 'list'], refetchType: 'none' });
        void client.invalidateQueries({ queryKey: ['products', 'deals'], refetchType: 'none' });
        void client.invalidateQueries({ queryKey: ['search', 'products'], refetchType: 'none' });
      }
    },
  });
}
