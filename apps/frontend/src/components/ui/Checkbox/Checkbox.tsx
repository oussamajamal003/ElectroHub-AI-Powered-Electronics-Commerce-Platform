import React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './Checkbox.module.scss';

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={clsx(styles.checkbox, className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={styles.indicator}
    >
      {props.checked === 'indeterminate' ? (
        <Minus className={styles.icon} strokeWidth={3} />
      ) : (
        <Check className={styles.icon} strokeWidth={3} />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));

Checkbox.displayName = CheckboxPrimitive.Root.displayName;
