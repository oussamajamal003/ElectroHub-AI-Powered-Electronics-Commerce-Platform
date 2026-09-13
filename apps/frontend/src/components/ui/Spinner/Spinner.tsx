import React from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import styles from './Spinner.module.scss';

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: 'small' | 'medium' | 'large';
}

export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size = 'medium', ...props }, ref) => (
    <Loader2
      ref={ref}
      className={clsx(
        styles.spinner,
        styles[`size-${size}`],
        className
      )}
      aria-hidden="true"
      {...props}
    />
  )
);
Spinner.displayName = 'Spinner';
