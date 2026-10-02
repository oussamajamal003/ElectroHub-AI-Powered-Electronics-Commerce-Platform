import { createContext, useContext } from 'react';
import type { CartData, CartInputItem } from './types';

export interface CartContextValue {
  data: CartData | undefined;
  totalQuantity: number;
  isGuest: boolean;
  isLoggingOut: boolean;
  isLoading: boolean;
  isError: boolean;
  isMutating: boolean;
  pendingProductIds: string[];
  pendingRemoveProductIds: string[];
  mergeError: string | null;
  pendingGuestItems: CartInputItem[];
  addItem: (productId: string, quantity?: number) => Promise<void>;
  setQuantity: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  retry: () => Promise<void>;
  retryMerge: () => Promise<void>;
  removePendingGuestItem: (productId: string) => void;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
