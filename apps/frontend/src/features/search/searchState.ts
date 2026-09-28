export type SearchSort = 'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'name-asc';
export interface SearchState {
  q: string; category?: string; brand?: string; availability?: 'available' | 'unavailable';
  minPrice?: string; maxPrice?: string; sort?: SearchSort; page: number; pageSize: number;
}
const keys = ['q', 'category', 'brand', 'availability', 'minPrice', 'maxPrice', 'sort', 'page', 'pageSize'] as const;
export const emptySearch: SearchState = { q: '', page: 1, pageSize: 20 };
export const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, ' ');
export function parseSearch(params: URLSearchParams): SearchState {
  for (const key of keys) if (params.getAll(key).length > 1) throw new Error('Repeated search parameter.');
  const q = normalizeQuery(params.get('q') ?? '');
  if (q.length > 120) throw new Error('Search must be 120 characters or fewer.');
  const integer = (key: string, fallback: number, maximum: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new Error('Invalid pagination.');
    return Number(value);
  };
  const state: SearchState = { q, page: integer('page', 1, 1000), pageSize: integer('pageSize', 20, 100) };
  for (const key of ['category', 'brand'] as const) {
    const value = params.get(key);
    if (value !== null) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 120) throw new Error('Invalid filter.');
      state[key] = value;
    }
  }
  const availability = params.get('availability');
  if (availability !== null) {
    if (availability !== 'available' && availability !== 'unavailable') throw new Error('Invalid availability.');
    state.availability = availability;
  }
  for (const key of ['minPrice', 'maxPrice'] as const) {
    const value = params.get(key);
    if (value !== null) {
      if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a valid nonnegative price.');
      state[key] = value;
    }
  }
  const cents = (value: string) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  if (state.minPrice !== undefined && state.maxPrice !== undefined && cents(state.minPrice) > cents(state.maxPrice)) {
    throw new Error('Minimum price must not exceed maximum price.');
  }
  const sort = params.get('sort');
  if (sort !== null) {
    if (!['relevance', 'price-asc', 'price-desc', 'newest', 'name-asc'].includes(sort)) throw new Error('Invalid sort.');
    state.sort = sort as SearchSort;
  }
  return state;
}
export function searchParams(state: SearchState) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = state[key];
    if (value !== undefined && value !== '' && !(key === 'page' && value === 1) && !(key === 'pageSize' && value === 20)) params.set(key, String(value));
  }
  return params;
}
export const activeSearch = (state: SearchState) => Boolean(state.q || state.category || state.brand || state.availability ||
  state.minPrice !== undefined || state.maxPrice !== undefined);
export const clearFilters = (state: SearchState): SearchState => ({ q: state.q, page: 1, pageSize: state.pageSize });
