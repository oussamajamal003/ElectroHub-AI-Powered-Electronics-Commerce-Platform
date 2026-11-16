import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { Button, ButtonProps } from '../Button';
import { Tooltip } from '../Tooltip';
import styles from './IconButton.module.scss';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  icon: React.ReactNode;
  'aria-label': string; // Required for accessibility
  /**
   * Hint shown on hover/focus. Defaults to the accessible name, so every icon-only button explains itself. Pass a string to say more
   * ("Delete product — this cannot be undone"), or `false` when an adjacent visible label already names the control.
   */
  tooltip?: React.ReactNode | false;
  /** Why the button is disabled. Shown through a focusable wrapper, since a disabled button receives no hover or focus. */
  disabledReason?: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, icon, size = 'medium', tooltip, disabledReason, ...props }, ref) => {
    const button = (
      <Button
        className={clsx(styles.iconButton, styles[`size-${size}`], className)}
        size={size}
        ref={ref}
        {...props}
      >
        {icon}
      </Button>
    );
    if (props.disabled) return disabledReason ? <Tooltip content={disabledReason} focusableWrapper>{button}</Tooltip> : button;
    if (tooltip === false) return button;
    return <Tooltip content={tooltip ?? props['aria-label']}>{button}</Tooltip>;
  }
);

IconButton.displayName = 'IconButton';
