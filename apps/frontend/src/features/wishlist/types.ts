import type { ProductSummary } from '@/features/products/types';

export interface WishlistItem {
  productId: string;
  product: ProductSummary | null;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE';
}
export interface WishlistData { items: WishlistItem[]; totalItems: number }
export interface ReconciledWishlist extends WishlistData { unresolved: { productId: string; reason: 'UNAVAILABLE' }[] }
