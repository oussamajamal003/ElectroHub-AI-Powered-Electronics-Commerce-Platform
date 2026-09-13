import React from 'react';
import { clsx } from 'clsx';
import styles from './StatusBadge.module.scss';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The semantic status variant to display.
   * @default 'neutral'
   */
  variant?: 'success' | 'warning' | 'error' | 'neutral';
  /**
   * The size of the status badge.
   * @default 'md'
   */
  size?: 'sm' | 'md';
}

export const StatusBadge = React.forwardRef<HTMLDivElement, StatusBadgeProps>(
  ({ className, variant = 'neutral', size = 'md', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          styles.statusBadge,
          styles[`size-${size}`],
          className
        )}
        {...props}
      >
        <span 
          className={clsx(styles.dot, styles[`variant-${variant}`])} 
          aria-hidden="true" 
        />
        <span className={styles.text}>{children}</span>
      </div>
    );
  }
);

StatusBadge.displayName = 'StatusBadge';
