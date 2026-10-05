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
}

export function ProductPurchaseActions({ product, quantity, remainingQuantity, pending = false, feedback, wishlistError, wishlistAction, onQuantityChange, onAdd }: ProductPurchaseActionsProps) {
  const stock = stockPresentation(product.stockStatus === undefined ? product.availability === 'AVAILABLE' ? 'IN_STOCK' : null : product.stockStatus);
  const unavailable = product.stockStatus === 'OUT_OF_STOCK' || product.purchasable === false || product.availability !== 'AVAILABLE';
  return <>
    <div className={unavailable ? styles.unavailable : styles.availability}><StatusBadge variant={stock.variant}>{stock.label}</StatusBadge>{product.stockStatus === 'LOW_STOCK' && <p className={styles.lowStockFeedback}>Only {product.availableQuantity} left</p>}</div>
    <div className={styles.cartActions}>
      <div className={styles.quantityRow}><span>Qty</span><QuantitySelector quantity={quantity} productName={product.name} maxQuantity={remainingQuantity} disabled={unavailable || pending}
        onIncrease={() => onQuantityChange(Math.min(remainingQuantity, quantity + 1))} onDecrease={() => onQuantityChange(Math.max(1, quantity - 1))} /></div>
      {unavailable || remainingQuantity === 0 ? <p role="status">{unavailable ? 'Currently unavailable.' : 'You already have the available stock in your cart.'}</p>
        : <p role="status">{remainingQuantity} more {remainingQuantity === 1 ? 'item' : 'items'} available to add.</p>}
      <div className={styles.purchaseButtons}><Button type="button" disabled={unavailable || remainingQuantity === 0 || pending} isLoading={pending} onClick={() => void onAdd()}>Add to Cart</Button>{wishlistAction}</div>
      {wishlistError && <p role="alert">{wishlistError}</p>}
      {feedback && <p role="status" className={styles.cartFeedback}>{feedback}</p>}
    </div>
  </>;
}
