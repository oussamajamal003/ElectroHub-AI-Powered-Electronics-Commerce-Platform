import React from 'react';
import { clsx } from 'clsx';
import styles from './Badge.module.scss';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'neutral', size = 'md', icon, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          styles.badge,
          styles[`variant-${variant}`],
          styles[`size-${size}`],
          className
        )}
        {...props}
      >
        {icon && <span className={styles.icon}>{icon}</span>}
        {children}
      </div>
    );
  }
);

Badge.displayName = 'Badge';
