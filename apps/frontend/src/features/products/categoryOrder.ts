import type { Category } from './types';

/** Largest real assortments first (ties by name): data-driven, not an editorial ranking. */
export function orderCategoriesByCount(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
}
