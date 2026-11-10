import { createContext, useContext } from 'react';
import type { CartData, CartInputItem } from './types';

/** Thrown by addItem while the stored session is still being re-verified; callers can recognise it instead of guessing a cause. */
export const SESSION_CHECK_MESSAGE = 'Checking your session. Please try again.';

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
  pendingAdditions?: Record<string, number>;
  isAddPending?: boolean;
  mergeError: string | null;
  pendingGuestItems: CartInputItem[];
  addItem: (productId: string, quantity?: number) => Promise<void>;
  setQuantity: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  retry: (options?: { onlyIfStale?: boolean }) => Promise<void>;
  validateRoute: () => Promise<void>;
  retryMerge: () => Promise<void>;
  removePendingGuestItem: (productId: string) => void;
  submitCheckout: <T>(operation: () => Promise<{ cart: CartData; result: T }>) => Promise<T>;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
