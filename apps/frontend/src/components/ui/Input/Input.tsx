import React, { forwardRef } from 'react';
import clsx from 'clsx';
import styles from './Input.module.scss';
import { AlertCircle } from 'lucide-react';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  inputSize?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      helperText,
      error,
      inputSize = 'medium',
      fullWidth = false,
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
          { [styles.fullWidth]: fullWidth },
          className
        )}
      >
        {label && (
          <label
            htmlFor={inputId}
            className={clsx(styles.label, { [styles.labelDisabled]: disabled })}
          >
            {label}
            {props.required && <span className={styles.required}>*</span>}
          </label>
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
            className={clsx(styles.input, styles[`size-${inputSize}`], {
              [styles.error]: isError,
            })}
            {...props}
          />
          {isError && (
            <div className={styles.errorIcon}>
              <AlertCircle size={16} aria-hidden="true" />
            </div>
          )}
        </div>
        {isError ? (
          <span id={errorId} className={styles.errorMessage}>
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
