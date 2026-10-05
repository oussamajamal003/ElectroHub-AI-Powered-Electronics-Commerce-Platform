import { useCallback, useEffect, useRef } from 'react';
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
  increaseDisabled?: boolean;
  decreaseDisabled?: boolean;
  productName?: string;
}

function useHoldAction(action: () => void, disabled: boolean) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;
  const isHoldingRef = useRef(false);

  const stop = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      stop();
    }
  }, [disabled, stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const start = useCallback(() => {
    if (disabled) return;
    stop();
    isHoldingRef.current = false;
    timeoutRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      intervalRef.current = setInterval(() => {
        actionRef.current();
      }, 100);
    }, 350);
  }, [disabled, stop]);

  const handleClick = useCallback(() => {
    if (isHoldingRef.current) {
      isHoldingRef.current = false;
      return;
    }
    actionRef.current();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.repeat) {
      actionRef.current();
    }
  }, []);

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
  };
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
  increaseDisabled = false,
  decreaseDisabled = false,
  productName,
}: QuantitySelectorProps) {
  const isDecreaseDisabled = disabled || decreaseDisabled || quantity <= minQuantity;
  const isIncreaseDisabled = disabled || increaseDisabled || (maxQuantity !== undefined && quantity >= maxQuantity);

  const decreaseHold = useHoldAction(onDecrease, isDecreaseDisabled);
  const increaseHold = useHoldAction(onIncrease, isIncreaseDisabled);

  return (
    <div 
      className={`${styles.container} ${styles[size]} ${className}`}
      role="group"
      aria-label="Quantity selector"
    >
      <button
        type="button"
        className={styles.button}
        disabled={isDecreaseDisabled}
        aria-label={productName ? `Decrease quantity for ${productName}` : 'Decrease quantity'}
        {...decreaseHold}
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
        disabled={isIncreaseDisabled}
        aria-label={productName ? `Increase quantity for ${productName}` : 'Increase quantity'}
        {...increaseHold}
      >
        <Plus className={styles.icon} />
      </button>
    </div>
  );
}
