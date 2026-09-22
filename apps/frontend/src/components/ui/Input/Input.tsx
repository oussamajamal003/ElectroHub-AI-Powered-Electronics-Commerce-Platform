import React, { forwardRef } from 'react';
import clsx from 'clsx';
import styles from './Input.module.scss';
import { AlertCircle } from 'lucide-react';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  labelRight?: React.ReactNode;
  helperText?: string;
  error?: string;
  inputSize?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  endAdornment?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      labelRight,
      helperText,
      error,
      inputSize = 'medium',
      fullWidth = false,
      endAdornment,
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    // Generate a unique ID if none provided and we have a label/helper text
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const isError = Boolean(error);

    return (
      <div
        className={clsx(
          styles.container,
          fullWidth && styles.fullWidth,
          className
        )}
      >
        {(label || labelRight) && (
          <div className={styles.labelRow}>
            {label && (
              <label
                htmlFor={inputId}
                className={clsx(
                  styles.label, 
                  disabled && styles.labelDisabled,
                  isError && styles.labelError
                )}
              >
                {label}
                {props.required && <span className={styles.required}>*</span>}
              </label>
            )}
            {labelRight && <div className={styles.labelRight}>{labelRight}</div>}
          </div>
        )}
        <div className={styles.inputWrapper}>
          <input
            id={inputId}
            ref={ref}
            disabled={disabled}
            aria-invalid={isError ? 'true' : undefined}
            aria-describedby={
              clsx({
                [errorId]: isError,
                [helperId]: helperText && !isError,
              }) || undefined
            }
            className={clsx(styles.input, styles[`size-${inputSize}`], isError && styles.error, endAdornment && styles.hasEndAdornment)}
            {...props}
          />
          {endAdornment && (
            <div className={styles.endAdornment}>
              {endAdornment}
            </div>
          )}
        </div>
        {isError ? (
          <span id={errorId} className={styles.errorMessage}>
            <AlertCircle size={14} className={styles.errorMessageIcon} />
            {error}
          </span>
        ) : helperText ? (
          <span id={helperId} className={styles.helperText}>
            {helperText}
          </span>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
