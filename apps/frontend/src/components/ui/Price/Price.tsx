import React from 'react';
import clsx from 'clsx';
import styles from './Price.module.scss';

export interface PriceProps extends React.HTMLAttributes<HTMLDivElement> {
  currentPrice: number;
  originalPrice?: number;
  currency?: string;
  locale?: string;
}

export const Price = React.forwardRef<HTMLDivElement, PriceProps>(
  (
    {
      className,
      currentPrice,
      originalPrice,
      currency = 'USD',
      locale = 'en-US',
      ...props
    },
    ref
  ) => {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    });

    const hasDiscount = originalPrice && originalPrice > currentPrice;
    let discountPercent = 0;
    
    if (hasDiscount) {
      discountPercent = Math.round(
        ((originalPrice - currentPrice) / originalPrice) * 100
      );
    }

    return (
      <div ref={ref} className={clsx(styles.priceContainer, className)} {...props}>
        <span className={styles.currentPrice}>
          {formatter.format(currentPrice)}
        </span>
        {hasDiscount && (
          <div className={styles.discountContainer}>
            <span
              className={styles.originalPrice}
              aria-label={`Original price: ${formatter.format(originalPrice)}`}
            >
              <span aria-hidden="true">{formatter.format(originalPrice)}</span>
            </span>
            <span
              className={styles.discountBadge}
              aria-label={`Discount: ${discountPercent} percent`}
            >
              -{discountPercent}%
            </span>
          </div>
        )}
      </div>
    );
  }
);
Price.displayName = 'Price';
