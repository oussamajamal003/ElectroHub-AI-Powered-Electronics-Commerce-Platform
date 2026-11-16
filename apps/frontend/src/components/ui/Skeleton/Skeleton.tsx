import React from 'react';
import clsx from 'clsx';
import styles from './Skeleton.module.scss';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The variant of the skeleton.
   * @default 'rectangular'
   */
  variant?: 'rectangular' | 'circular' | 'text';
  /**
   * Optional width of the skeleton. Useful when variant is 'text' or 'rectangular'.
   */
  width?: string | number;
  /**
   * Optional height of the skeleton. Useful when variant is 'rectangular'.
   */
  height?: string | number;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = 'rectangular', width, height, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          styles.skeleton,
          styles[`variant-${variant}`],
          className
        )}
        style={{
          width: width,
          height: height,
          ...props.style,
        }}
        aria-hidden="true"
        {...props}
      />
    );
  }
);
Skeleton.displayName = 'Skeleton';
