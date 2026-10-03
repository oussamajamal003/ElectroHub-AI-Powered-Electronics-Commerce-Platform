import { createContext, useContext } from 'react';
import type { ProductSummary } from '@/features/products/types';
import type { WishlistData } from './types';

export interface WishlistContextValue {
  data: WishlistData | undefined;
  expectedCount: number | undefined;
  productIds: string[];
  totalItems: number;
  isLoading: boolean;
  isError: boolean;
  isLoggingOut: boolean;
  isMerging: boolean;
  error: string | null;
  mergeError: string | null;
  unresolved: string[];
  pending: string[];
  toggle: (productId: string, product?: ProductSummary) => void;
  retry: () => Promise<void>;
  retryMerge: () => Promise<void>;
  discardGuest: (productId: string) => void;
}
export const WishlistContext = createContext<WishlistContextValue | null>(null);
export function useWishlist() { return useContext(WishlistContext); }
