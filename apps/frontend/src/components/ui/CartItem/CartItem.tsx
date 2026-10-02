import { Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { QuantitySelector } from '../QuantitySelector';
import { ProductImage } from '../ProductImage';
import styles from './CartItem.module.scss';

export interface CartItemProps {
  id: string | number;
  title: string;
  subtitle?: string;
  price: number | null;
  discountPrice?: number;
  imageUrl: string;
  quantity: number;
  onQuantityChange: (id: string | number, quantity: number) => void;
  onRemove: (id: string | number) => void;
  className?: string;
  maxQuantity?: number;
  unavailable?: boolean;
  disabled?: boolean;
  productHref?: string;
}

export function CartItem({
  id,
  title,
  subtitle,
  price,
  discountPrice,
  imageUrl,
  quantity,
  onQuantityChange,
  onRemove,
  className = '',
  maxQuantity,
  unavailable = false,
  disabled = false,
  productHref,
}: CartItemProps) {
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleIncrease = () => {
    if (maxQuantity !== undefined && quantity >= maxQuantity) return;
    const next = Math.min(maxQuantity ?? 999, quantity + 1);
    onQuantityChange(id, next);
  };

  const handleDecrease = () => {
    if (quantity <= 1) return;
    const next = maxQuantity !== undefined && quantity > maxQuantity ? maxQuantity : quantity - 1;
    onQuantityChange(id, next);
  };

  const handleRemove = () => {
    onRemove(id);
  };

  const productContent = <>
      <div className={styles.imageContainer}>
        <ProductImage src={imageUrl} alt={title} className={styles.image} loading="lazy" />
      </div>
      
      <div className={styles.details}>
        <div className={styles.header}>
          <div className={styles.titleInfo}>
            <h4 className={styles.title}>{title}</h4>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            <div className={styles.priceContainer}>
              {price === null ? <span className={styles.price}>Price unavailable</span> : discountPrice !== undefined ? <>
                <span className={styles.discountPrice}>{formatPrice(discountPrice)}</span>
                <span className={styles.originalPrice}>{formatPrice(price)}</span>
              </> : <span className={styles.price}>{formatPrice(price)}</span>}
            </div>
          </div>
        </div>

      </div>
  </>;

  return (
    <div className={`${styles.cartItem} ${className}`} data-testid="cart-item">
      {productHref ? <Link to={productHref} className={styles.productLink}>{productContent}</Link>
        : <div className={styles.productLink}>{productContent}</div>}
      <div className={styles.footer}>
          <div className={styles.actions} onClick={event => event.stopPropagation()}>
            <QuantitySelector 
              quantity={quantity} 
              maxQuantity={maxQuantity}
              disabled={disabled || unavailable}
              productName={title}
              onIncrease={handleIncrease} 
              onDecrease={handleDecrease}
              size="small"
            />
            <button 
              type="button" 
              className={styles.removeButton}
              onClick={event => { event.stopPropagation(); handleRemove(); }}
              aria-label={`Remove ${title} from cart`}
            >
              <Trash2 className={styles.removeIcon} />
            </button>
          </div>
        </div>
    </div>
  );
}
