import { Minus, Plus } from 'lucide-react';
import styles from './QuantitySelector.module.scss';

export interface QuantitySelectorProps {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  minQuantity?: number;
  maxQuantity?: number;
  size?: 'small' | 'medium' | 'large';
  className?: string;
  disabled?: boolean;
}

export function QuantitySelector({
  quantity,
  onIncrease,
  onDecrease,
  minQuantity = 1,
  maxQuantity,
  size = 'medium',
  className = '',
  disabled = false,
}: QuantitySelectorProps) {
  const isDecreaseDisabled = disabled || quantity <= minQuantity;
  const isIncreaseDisabled = disabled || (maxQuantity !== undefined && quantity >= maxQuantity);

  return (
    <div 
      className={`${styles.container} ${styles[size]} ${className}`}
      role="group"
      aria-label="Quantity selector"
    >
      <button
        type="button"
        className={styles.button}
        onClick={onDecrease}
        disabled={isDecreaseDisabled}
        aria-label="Decrease quantity"
      >
        <Minus className={styles.icon} />
      </button>
      
      <span 
        className={styles.quantity}
        aria-live="polite"
      >
        {quantity}
      </span>
      
      <button
        type="button"
        className={styles.button}
        onClick={onIncrease}
        disabled={isIncreaseDisabled}
        aria-label="Increase quantity"
      >
        <Plus className={styles.icon} />
      </button>
    </div>
  );
}
