import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { QuantitySelector } from '@/components/ui/QuantitySelector';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { stockPresentation } from '@/features/products/stockPresentation';
import type { ProductDetail } from '@/features/products/types';
import styles from './ProductDetailPage.module.scss';

export interface ProductPurchaseActionsProps {
  product: Pick<ProductDetail, 'name' | 'stockStatus' | 'availableQuantity' | 'availability' | 'purchasable'>;
  quantity: number;
  remainingQuantity: number;
  pending?: boolean;
  feedback?: string;
  wishlistError?: string | null;
  wishlistAction?: ReactNode;
  onQuantityChange: (quantity: number) => void;
  onAdd: () => Promise<void> | void;
  onBuyNow?: () => Promise<void> | void;
}

export function ProductPurchaseActions({ product, quantity, remainingQuantity, pending = false, feedback, wishlistError, wishlistAction, onQuantityChange, onAdd, onBuyNow }: ProductPurchaseActionsProps) {
  const stockStatus = product.stockStatus === undefined ? product.availability === 'AVAILABLE' ? 'IN_STOCK' : null : product.stockStatus;
  const stock = stockPresentation(stockStatus);
  const unavailable = product.stockStatus === 'OUT_OF_STOCK' || product.purchasable === false || product.availability !== 'AVAILABLE';
  // Exact sellable quantity from the server (never adjusted locally): Add to Cart reserves nothing, so it is the same for every shopper.
  const available = product.availableQuantity ?? 0;
  const quantityCopy = unavailable || available <= 0 ? null : stockStatus === 'LOW_STOCK' ? `Only ${available} left`
    : stockStatus === 'IN_STOCK' ? `${available} available` : null;
  // The cart-relative line only adds information once this shopper's Cart already holds some of the stock (or a quantity cap applies).
  const cartLimited = remainingQuantity !== available;
  return <>
    <div className={unavailable ? styles.unavailable : styles.availability}><StatusBadge variant={stock.variant}>{stock.label}</StatusBadge>{quantityCopy && <p className={stockStatus === 'LOW_STOCK' ? styles.lowStockFeedback : styles.stockQuantity} data-testid="product-available-quantity">{quantityCopy}</p>}</div>
    <div className={styles.cartActions}>
      <div className={styles.quantityRow}><span>Qty</span><QuantitySelector quantity={quantity} productName={product.name} maxQuantity={remainingQuantity} disabled={unavailable || pending}
        onIncrease={() => onQuantityChange(Math.min(remainingQuantity, quantity + 1))} onDecrease={() => onQuantityChange(Math.max(1, quantity - 1))} /></div>
      {unavailable || remainingQuantity === 0 ? <p role="status">{unavailable ? 'Currently unavailable.' : 'You already have the available stock in your cart.'}</p>
        : cartLimited && <p role="status">{remainingQuantity} more {remainingQuantity === 1 ? 'item' : 'items'} available to add.</p>}
      <div className={styles.purchaseButtons}><Button type="button" size="large" disabled={unavailable || remainingQuantity === 0 || pending} isLoading={pending} onClick={() => void onAdd()}>Add to Cart</Button>{onBuyNow && <Button type="button" size="large" variant="outline" className={styles.buyNowButton} disabled={unavailable || pending || (product.availableQuantity ?? 0) < quantity} onClick={() => void onBuyNow()}>Buy Now</Button>}{wishlistAction}</div>
      {wishlistError && <p role="alert">{wishlistError}</p>}
      {feedback && <p role="status" className={styles.cartFeedback}>{feedback}</p>}
    </div>
  </>;
}
