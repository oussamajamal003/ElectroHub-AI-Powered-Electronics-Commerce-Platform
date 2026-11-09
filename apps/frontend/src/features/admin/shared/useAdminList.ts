import { useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString, type ListResponse } from './api';

/**
 * Lists are fresh for 30 s: going back to a filter, tab or page seen in that window renders from cache with no request (writes still
 * invalidate them at once). Measured on shared DEV, query execution is under 1 ms; each request's cost is the network round trips to the
 * database region, so avoiding requests is what makes switching instant.
 */
export const LIST_STALE_MS = 30_000;
const PAGE_SIZE = 20;

type QueryValues = Record<string, string | number | undefined | null>;

/**
 * Shared admin list query: one cache entry per exact parameter set, previous rows kept while a new set loads (`isPlaceholderData`), the
 * superseded request aborted through React Query's signal, and the neighbouring pages prefetched once the current page is real data so
 * Next/Previous usually render without waiting.
 */
export function useAdminList<R extends ListResponse<unknown>, P extends { page: number } = { page: number }>(path: string, key: (search: string) => readonly unknown[], params: P, enabled = true) {
  const values = params as unknown as QueryValues;
  const client = useQueryClient();
  const search = queryString({ ...values, pageSize: PAGE_SIZE });
  const query = useQuery({
    queryKey: key(search),
    queryFn: ({ signal }) => apiClient<R>(`${path}${search}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: LIST_STALE_MS,
    enabled,
  });
  const meta = query.data?.meta;
  const settled = Boolean(meta) && !query.isPlaceholderData;
  const page = meta?.page ?? 0;
  const totalPages = meta?.totalPages ?? 0;
  useEffect(() => {
    if (!settled) return;
    for (const neighbour of [page + 1, page - 1]) {
      if (neighbour < 1 || neighbour > totalPages) continue;
      const neighbourSearch = queryString({ ...values, page: neighbour, pageSize: PAGE_SIZE });
      void client.prefetchQuery({ queryKey: key(neighbourSearch), staleTime: LIST_STALE_MS,
        queryFn: ({ signal }) => apiClient<R>(`${path}${neighbourSearch}`, { signal }) });
    }
    // `search` captures every parameter; params/key/path are re-created each render with the same meaning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, page, totalPages, search, client]);
  return query;
}
