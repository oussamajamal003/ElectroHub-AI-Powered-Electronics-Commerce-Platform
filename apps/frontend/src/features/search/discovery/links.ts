import type { Suggestion } from '../api';
import { emptySearch, normalizeQuery, searchParams } from '../searchState';

/** Products open their detail page; brands and categories open the filtered catalog (the only view that accepts those filters). */
export const suggestionHref = (suggestion: Suggestion) => suggestion.type === 'PRODUCT' ? `/products/${encodeURIComponent(suggestion.slug)}`
  : `/products?${new URLSearchParams({ [suggestion.type === 'BRAND' ? 'brand' : 'category']: suggestion.slug })}`;

/** Full results keep the existing /search URL contract; an empty query browses the catalog. */
export const resultsHref = (query: string) => {
  const q = normalizeQuery(query);
  return q ? `/search?${searchParams({ ...emptySearch, q })}` : '/products';
};
