import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { Button, ButtonProps } from '../Button';
import styles from './IconButton.module.scss';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  icon: React.ReactNode;
  'aria-label': string; // Required for accessibility
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, icon, size = 'medium', ...props }, ref) => {
    return (
      <Button
        className={clsx(styles.iconButton, styles[`size-${size}`], className)}
        size={size}
        ref={ref}
        {...props}
      >
        {icon}
      </Button>
    );
  }
);

IconButton.displayName = 'IconButton';
