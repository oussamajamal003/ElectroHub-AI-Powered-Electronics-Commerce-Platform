import { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartContext } from '@/features/cart/context';
import { useWishlist } from '@/features/wishlist/context';
import type { ProductSummary } from '@/features/products/types';

/** The store's own cart, wishlist and navigation actions for ProductCards in a rail (contexts are optional in stories). */
export function useStoreCardActions() {
  const cart = useContext(CartContext);
  const wishlist = useWishlist();
  const navigate = useNavigate();
  return {
    navigate,
    cardActions: {
      wishlistIds: wishlist?.productIds, wishlistPending: wishlist?.pending,
      onToggleWishlist: wishlist ? (id: string, product: ProductSummary) => wishlist.toggle(id, product) : undefined,
      onAddToCart: cart ? (id: string) => cart.addItem(id) : undefined,
    },
  };
}
