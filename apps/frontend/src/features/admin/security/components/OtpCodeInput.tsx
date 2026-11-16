import type { ClipboardEvent } from 'react';
import { Input } from '@/components/ui/Input';
import styles from './AdminSecurity.module.scss';

export const OTP_LENGTH = 6;
/** Keeps digits only, at most six: the same rule for typing, pasting and autofill. */
export const sanitizeOtp = (value: string) => value.replace(/\D/g, '').slice(0, OTP_LENGTH);

export interface OtpCodeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown below the field and linked with aria-describedby; errors are never auto-dismissed by submitting again. */
  error?: string;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
}

/**
 * Single six-digit field: numeric keyboard, one-time-code autofill, paste of a full code, no auto-submit. The parent decides when to
 * verify, so an error from the previous attempt stays visible until the administrator acts again.
 */
export function OtpCodeInput({ id, label, value, onChange, error, helperText, disabled, autoFocus, name = 'code' }: OtpCodeInputProps) {
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = sanitizeOtp(event.clipboardData.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
  };

  return (
    <div className={styles.otpField}>
      <Input
        id={id}
        name={name}
        label={label}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={OTP_LENGTH}
        value={value}
        onChange={(event) => onChange(sanitizeOtp(event.target.value))}
        onPaste={handlePaste}
        error={error}
        helperText={helperText}
        disabled={disabled}
        autoFocus={autoFocus}
        fullWidth
        placeholder="123456"
      />
    </div>
  );
}
