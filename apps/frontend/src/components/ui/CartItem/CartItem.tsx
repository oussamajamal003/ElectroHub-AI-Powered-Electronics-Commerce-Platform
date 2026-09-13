import { Trash2 } from 'lucide-react';
import { QuantitySelector } from '../QuantitySelector';
import styles from './CartItem.module.scss';

export interface CartItemProps {
  id: string | number;
  title: string;
  subtitle?: string;
  price: number;
  discountPrice?: number;
  imageUrl: string;
  quantity: number;
  onQuantityChange: (id: string | number, quantity: number) => void;
  onRemove: (id: string | number) => void;
  className?: string;
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
}: CartItemProps) {
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleIncrease = () => {
    onQuantityChange(id, quantity + 1);
  };

  const handleDecrease = () => {
    if (quantity > 1) {
      onQuantityChange(id, quantity - 1);
    }
  };

  const handleRemove = () => {
    onRemove(id);
  };

  return (
    <div className={`${styles.cartItem} ${className}`} data-testid="cart-item">
      <div className={styles.imageContainer}>
        <img src={imageUrl} alt={title} className={styles.image} loading="lazy" />
      </div>
      
      <div className={styles.details}>
        <div className={styles.header}>
          <div className={styles.titleInfo}>
            <h4 className={styles.title}>{title}</h4>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button 
            type="button" 
            className={styles.removeButtonDesktop}
            onClick={handleRemove}
            aria-label={`Remove ${title} from cart`}
          >
            <Trash2 className={styles.removeIcon} />
          </button>
        </div>

        <div className={styles.footer}>
          <div className={styles.priceContainer}>
            {discountPrice !== undefined ? (
              <>
                <span className={styles.discountPrice}>{formatPrice(discountPrice)}</span>
                <span className={styles.originalPrice}>{formatPrice(price)}</span>
              </>
            ) : (
              <span className={styles.price}>{formatPrice(price)}</span>
            )}
          </div>
          
          <div className={styles.actions}>
            <QuantitySelector 
              quantity={quantity} 
              onIncrease={handleIncrease} 
              onDecrease={handleDecrease}
              size="small"
            />
            <button 
              type="button" 
              className={styles.removeButtonMobile}
              onClick={handleRemove}
              aria-label={`Remove ${title} from cart`}
            >
              <Trash2 className={styles.removeIcon} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
