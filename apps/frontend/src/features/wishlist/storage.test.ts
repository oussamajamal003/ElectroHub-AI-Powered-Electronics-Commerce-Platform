import { beforeEach, expect, it, vi } from 'vitest';
import { normalizeWishlist, readWishlist, writeWishlist, WISHLIST_STORAGE_KEY } from './storage';
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('handles corruption, wrong types, invalid UUIDs and duplicate normalization', () => {
  localStorage.setItem(WISHLIST_STORAGE_KEY, '{broken'); expect(readWishlist()).toEqual([]);
  expect(normalizeWishlist({ productIds: [productId, productId.toUpperCase(), 3, 'bad'] })).toEqual([productId]);
  expect(normalizeWishlist({ productIds: 'bad' })).toEqual([]);
});
it('persists only IDs and clears empty storage', () => {
  expect(writeWishlist([productId])).toBe(true); expect(readWishlist()).toEqual([productId]);
  expect(JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY)!)).toEqual({ productIds: [productId] });
  expect(writeWishlist([])).toBe(true); expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).toBeNull();
});
it('bounds untrusted storage to fifty distinct products', () => {
  expect(normalizeWishlist({ productIds: Array.from({ length: 60 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`) })).toHaveLength(50);
});
it('reports storage failures without false success', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(writeWishlist([productId])).toBe(false);
});
