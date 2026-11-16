import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DataTableSort } from '@/components/ui/DataTable';

const SEARCH_DELAY_MS = 200;

interface Options<F extends string> {
  /** Allowed values (or a validator) per filter key; anything else in the URL is ignored (no client-forged filter reaches the API). */
  filters: Record<F, readonly string[] | ((value: string) => boolean)>;
  sortKeys: readonly string[];
  defaultSort: DataTableSort;
}

/**
 * URL-backed list state for admin tables: search (debounced), filters, sort and page survive refresh, deep links and back/forward.
 * Changing search/filter/sort always returns to page 1. Query keys are derived from the committed URL, so a slower response for an
 * older search can never overwrite the newer one (each parameter set has its own React Query entry).
 */
export function useListParams<F extends string>({ filters, sortKeys, defaultSort }: Options<F>) {
  const [params, setParams] = useSearchParams();
  const committedQ = (params.get('q') ?? '').slice(0, 100);
  const [search, setSearch] = useState(committedQ);

  // Follow back/forward navigation into the input.
  useEffect(() => { setSearch(committedQ); }, [committedQ]);

  const update = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') next.delete(key); else next.set(key, value);
      }
      if (resetPage) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === committedQ) return;
    const timer = window.setTimeout(() => update({ q: trimmed || null }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, committedQ, update]);

  const values = useMemo(() => {
    const filterValues = Object.fromEntries((Object.keys(filters) as F[]).map(key => {
      const value = params.get(key);
      const allowed = filters[key];
      return [key, value && (typeof allowed === 'function' ? allowed(value) : allowed.includes(value)) ? value : undefined];
    })) as Record<F, string | undefined>;
    const sortKey = params.get('sort');
    const order = params.get('order');
    const sort: DataTableSort = sortKey && sortKeys.includes(sortKey)
      ? { key: sortKey, order: order === 'desc' ? 'desc' : 'asc' } : defaultSort;
    const rawPage = params.get('page');
    const page = rawPage && /^[1-9]\d{0,3}$/.test(rawPage) ? Number(rawPage) : 1;
    return { q: committedQ, filters: filterValues, sort, page };
  }, [params, filters, sortKeys, defaultSort, committedQ]);

  return {
    ...values,
    search,
    setSearch,
    /** True while typed text has not been committed to the URL yet. */
    searchPending: search.trim() !== committedQ,
    setFilter: (key: F, value: string | undefined) => update({ [key]: value ?? null }),
    setSort: (sort: DataTableSort) => update({ sort: sort.key, order: sort.order }),
    setPage: (page: number) => update({ page: page > 1 ? String(page) : null }, false),
    reset: () => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); },
    isFiltered: Boolean(committedQ || Object.keys(filters).some(key => params.get(key))),
  };
}
