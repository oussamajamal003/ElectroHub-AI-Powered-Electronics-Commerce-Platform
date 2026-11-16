import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useListParams } from '../shared/useListParams';
import { queryString } from '../shared/api';

const FILTERS = { status: ['ACTIVE', 'INACTIVE'], categoryId: (value: string) => /^[0-9a-f-]{36}$/.test(value) } as const;
const SORT_KEYS = ['name', 'createdAt'] as const;
const DEFAULT_SORT = { key: 'createdAt', order: 'desc' } as const;

function setup(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  return renderHook(() => ({ list: useListParams({ filters: FILTERS, sortKeys: SORT_KEYS, defaultSort: DEFAULT_SORT }), location: useLocation() }), { wrapper });
}

describe('useListParams', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ignores forged or invalid URL values instead of sending them to the API', () => {
    const { result } = setup('/admin/products?status=DELETED&categoryId=1%27%20OR%201=1&sort=password&page=-3');
    expect(result.current.list.filters).toEqual({ status: undefined, categoryId: undefined });
    expect(result.current.list.sort).toEqual(DEFAULT_SORT);
    expect(result.current.list.page).toBe(1);
  });

  it('reads valid deep links and returns to page 1 when a filter changes', () => {
    const { result } = setup('/admin/products?status=ACTIVE&sort=name&order=asc&page=3');
    expect(result.current.list.filters.status).toBe('ACTIVE');
    expect(result.current.list.sort).toEqual({ key: 'name', order: 'asc' });
    expect(result.current.list.page).toBe(3);
    act(() => result.current.list.setFilter('status', 'INACTIVE'));
    expect(result.current.location.search).toBe('?status=INACTIVE&sort=name&order=asc');
    expect(result.current.list.isFiltered).toBe(true);
  });

  it('debounces search into the URL and reset clears everything', () => {
    vi.useFakeTimers();
    const { result } = setup('/admin/products');
    act(() => result.current.list.setSearch('  headphones '));
    expect(result.current.list.searchPending).toBe(true);
    expect(result.current.location.search).toBe('');
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.location.search).toBe('?q=headphones');
    act(() => result.current.list.reset());
    expect(result.current.location.search).toBe('');
    expect(result.current.list.search).toBe('');
  });
});

describe('queryString', () => {
  it('is stable regardless of key order and drops empty values', () => {
    expect(queryString({ b: 2, a: 'x', c: undefined, d: '' })).toBe('?a=x&b=2');
    expect(queryString({ a: 'x', b: 2 })).toBe(queryString({ b: 2, a: 'x' }));
    expect(queryString({})).toBe('');
  });
});
