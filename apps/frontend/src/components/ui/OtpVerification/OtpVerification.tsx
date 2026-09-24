import React, { useState, useEffect, useRef, useId } from 'react';
import clsx from 'clsx';
import { AlertCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '../Button/Button';
import styles from './OtpVerification.module.scss';

export interface OtpVerificationProps {
  /**
   * The 6-digit OTP code value (controlled).
   */
  value?: string;
  /**
   * Callback invoked whenever the OTP code value changes.
   */
  onChange?: (value: string) => void;
  /**
   * Callback invoked when the user submits the completed OTP.
   */
  onSubmit?: (value: string) => void;
  /**
   * Number of digits (default: 6).
   */
  length?: number;
  /**
   * Loading state during verification.
   */
  loading?: boolean;
  /**
   * Error message to display.
   */
  error?: string | null;
  /**
   * Whether the component inputs and buttons are disabled.
   */
  disabled?: boolean;
  /**
   * Whether the OTP challenge has expired.
   */
  expired?: boolean;
  /**
   * Whether the OTP challenge is locked due to excessive failed attempts.
   */
  locked?: boolean;
  /**
   * Whether resend is available.
   */
  resendAvailable?: boolean;
  /**
   * Loading state during resend.
   */
  resendLoading?: boolean;
  /**
   * Initial resend countdown in seconds (e.g. 60 or 42).
   */
  resendCountdownSeconds?: number;
  /**
   * Callback invoked when user requests a new code.
   */
  onResend?: () => void;
  /**
   * Header title (default: "Verify your email").
   */
  title?: string;
  /**
   * Header subtitle or instructions.
   */
  subtitle?: string;
  /**
   * Target email address displayed in the subtitle.
   */
  email?: string;
  /**
   * Optional callback for "Back to Login".
   */
  onBackToLogin?: () => void;
  /**
   * Custom brand header text (default: "ElectroHub").
   */
  brandName?: string;
  /**
   * Optional root HTML element ID.
   */
  id?: string;
  /**
   * Additional container class name.
   */
  className?: string;
}

export const OtpVerification: React.FC<OtpVerificationProps> = ({
  value: controlledValue,
  onChange,
  onSubmit,
  length = 6,
  loading = false,
  error = null,
  disabled = false,
  expired = false,
  locked = false,
  resendAvailable = true,
  resendLoading = false,
  resendCountdownSeconds = 0,
  onResend,
  title = 'Verify your email',
  subtitle,
  email,
  onBackToLogin,
  brandName = 'ElectroHub',
  id,
  className,
}) => {
  const baseId = useId();
  const componentId = id || baseId;

  // Uncontrolled fallback if value is not controlled
  const [internalValue, setInternalValue] = useState<string>('');
  const activeValue = controlledValue !== undefined ? controlledValue : internalValue;

  // Convert string to array of digits of exact length
  const digits = Array.from({ length }, (_, i) => activeValue[i] || '');

  // References to the 6 input elements for auto-focusing
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer state
  const [countdown, setCountdown] = useState<number>(resendCountdownSeconds);

  // Sync countdown whenever prop changes
  useEffect(() => {
    setCountdown(resendCountdownSeconds);
  }, [resendCountdownSeconds]);

  // Interval timer for countdown with safe unmount cleanup
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  const updateValue = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  };

  const handleInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || loading || locked) return;

    // Filter to digits only
    const rawVal = e.target.value.replace(/\D/g, '');

    if (!rawVal) {
      // Current digit cleared
      const nextDigits = [...digits];
      nextDigits[index] = '';
      updateValue(nextDigits.join(''));
      return;
    }

    // Take the last character typed
    const char = rawVal.slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = char;
    const combined = nextDigits.join('');
    updateValue(combined);

    // Auto-focus next input if available
    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || loading || locked) return;

    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Current is already empty; focus previous and clear it
        e.preventDefault();
        const nextDigits = [...digits];
        nextDigits[index - 1] = '';
        updateValue(nextDigits.join(''));
        inputRefs.current[index - 1]?.focus();
      } else if (digits[index]) {
        // Clear current
        e.preventDefault();
        const nextDigits = [...digits];
        nextDigits[index] = '';
        updateValue(nextDigits.join(''));
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const nextDigits = [...digits];
      nextDigits[index] = '';
      updateValue(nextDigits.join(''));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (disabled || loading || locked) return;

    const pastedText = e.clipboardData.getData('text');
    const numericChars = pastedText.replace(/\D/g, '').slice(0, length);

    if (!numericChars) return;

    updateValue(numericChars);

    // Focus the box following the last pasted digit
    const focusIndex = Math.min(numericChars.length, length - 1);
    inputRefs.current[focusIndex]?.focus();
  };

  const isComplete = activeValue.length === length && !digits.includes('');
  const isInputsDisabled = disabled || loading || locked;
  const isSubmitDisabled = isInputsDisabled || !isComplete || expired;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) return;
    onSubmit?.(activeValue);
  };

  const handleResend = () => {
    if (!resendAvailable || resendLoading || disabled || locked || countdown > 0) {
      return;
    }
    onResend?.();
  };

  // Determine state messaging
  const renderStateMessage = () => {
    if (locked) {
      return (
        <div className={clsx(styles.stateMessage, styles.locked)} role="alert">
          <AlertCircle size={16} className={styles.stateIcon} />
          <span>Too many attempts. Please request a new code.</span>
        </div>
      );
    }

    if (expired) {
      return (
        <div className={clsx(styles.stateMessage, styles.expired)} role="alert">
          <AlertTriangle size={16} className={styles.stateIcon} />
          <span>Code expired. Please request a new code.</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className={clsx(styles.stateMessage, styles.error)} role="alert">
          <AlertCircle size={16} className={styles.stateIcon} />
          <span>{error}</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div id={componentId} className={clsx(styles.container, className)}>
      {brandName && <div className={styles.brand}>{brandName}</div>}
      <h1 className={styles.title}>{title}</h1>

      {subtitle ? (
        <p className={styles.subtitle}>{subtitle}</p>
      ) : email ? (
        <p className={styles.subtitle}>
          We sent a verification code to <span className={styles.emailHighlight}>{email}</span>
        </p>
      ) : null}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.digitsGroup} role="group" aria-label="Verification code digits">
          {digits.map((digit, index) => {
            const inputId = `${componentId}-digit-${index}`;
            const isErrorState = Boolean(error) || locked;

            return (
              <input
                key={inputId}
                id={inputId}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                disabled={isInputsDisabled}
                aria-label={`Digit ${index + 1} of ${length}`}
                aria-invalid={isErrorState ? 'true' : undefined}
                className={clsx(
                  styles.digitInput,
                  isErrorState && styles.error,
                  digit && styles.filled
                )}
                onChange={(e) => handleInputChange(index, e)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                onFocus={(e) => e.target.select()}
              />
            );
          })}
        </div>

        {renderStateMessage()}

        <Button
          type="submit"
          variant="primary"
          size="large"
          isLoading={loading}
          disabled={isSubmitDisabled}
          onClick={handleSubmit}
          className={styles.submitButton}
        >
          {loading ? 'Verifying...' : 'Verify'}
        </Button>

        <div className={styles.footer}>
          {onResend && (
            <div className={styles.resendContainer}>
              <span>Didn&apos;t receive the code?</span>
              {countdown > 0 ? (
                <span className={styles.countdownText}>
                  Resend code in {countdown}s
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={!resendAvailable || resendLoading || disabled || locked}
                  className={styles.resendButton}
                >
                  {resendLoading ? 'Sending...' : 'Resend Code'}
                </button>
              )}
            </div>
          )}

          {onBackToLogin && (
            <button
              type="button"
              onClick={onBackToLogin}
              className={styles.backButton}
            >
              <ArrowLeft size={14} />
              <span>Back to Login</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
