import React, { forwardRef } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import styles from './Select.module.scss';

export interface SelectProps extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> {
  label?: string;
  error?: string;
  placeholder?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  fullWidth?: boolean;
}

export const Select = forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, SelectProps>(
  (
    { label, error, placeholder = 'Select an option...', options, fullWidth, disabled, ...props },
    ref
  ) => {
    const isError = Boolean(error);
    const generatedId = React.useId();

    return (
      <div className={clsx(styles.container, { [styles.fullWidth]: fullWidth })}>
        {label && (
          <label
            htmlFor={generatedId}
            className={clsx(styles.label, { [styles.labelDisabled]: disabled })}
          >
            {label}
            {props.required && <span className={styles.required}>*</span>}
          </label>
        )}
        <SelectPrimitive.Root disabled={disabled} {...props}>
          <SelectPrimitive.Trigger
            ref={ref}
            id={generatedId}
            className={clsx(styles.trigger, { [styles.error]: isError })}
          >
            <SelectPrimitive.Value placeholder={placeholder} />
            <SelectPrimitive.Icon className={styles.icon}>
              <ChevronDown size={16} />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              className={styles.content}
              position="popper"
              sideOffset={4}
            >
              <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
                <ChevronDown size={16} className={styles.scrollUpIcon} />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className={styles.viewport}>
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={styles.item}
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className={styles.itemIndicator}>
                      <Check size={16} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
                <ChevronDown size={16} />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
        {isError && <span className={styles.errorMessage}>{error}</span>}
      </div>
    );
  }
);

Select.displayName = 'Select';
