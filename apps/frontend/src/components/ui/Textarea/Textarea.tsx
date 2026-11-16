import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import styles from './Textarea.module.scss';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  fullWidth?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      helperText,
      error,
      fullWidth = false,
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const textareaId = id || generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    const isError = Boolean(error);

    return (
      <div
        className={clsx(
          styles.container,
          fullWidth && styles.fullWidth,
          className
        )}
      >
        {label && (
          <label
            htmlFor={textareaId}
            className={clsx(styles.label, disabled && styles.labelDisabled)}
          >
            {label}
            {props.required && <span className={styles.required}>*</span>}
          </label>
        )}
        <div className={styles.textareaWrapper}>
          <textarea
            id={textareaId}
            ref={ref}
            disabled={disabled}
            aria-invalid={isError ? 'true' : undefined}
            aria-describedby={
              clsx({
                [errorId]: isError,
                [helperId]: helperText && !isError,
              }) || undefined
            }
            className={clsx(styles.textarea, isError && styles.error)}
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

Textarea.displayName = 'Textarea';
