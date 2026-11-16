import { apiClient } from '@/lib/api';
import type { ReconciledWishlist, WishlistData } from './types';

export const wishlistApi = {
  get: (signal?: AbortSignal) => apiClient<{ data: WishlistData }>('/api/wishlist', { signal }),
  validate: (productIds: string[], signal?: AbortSignal) => apiClient<{ data: WishlistData }>('/api/wishlist/validate', { method: 'POST', data: { productIds }, signal }),
  add: (productId: string) => apiClient<{ data: WishlistData }>('/api/wishlist/items', { method: 'POST', data: { productId } }),
  remove: (productId: string) => apiClient<{ data: WishlistData }>(`/api/wishlist/items/${encodeURIComponent(productId)}`, { method: 'DELETE' }),
  reconcile: (productIds: string[]) => apiClient<{ data: ReconciledWishlist }>('/api/wishlist/reconcile', { method: 'POST', data: { productIds } }),
};
