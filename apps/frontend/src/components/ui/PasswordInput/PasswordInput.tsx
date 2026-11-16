import { forwardRef, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '../Input/Input';
import styles from './PasswordInput.module.scss';

export type PasswordInputProps = Omit<InputProps, 'type' | 'endAdornment'>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ disabled, ...props }, forwardedRef) => {
    const [visible, setVisible] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const setInputRef = (element: HTMLInputElement | null) => {
      inputRef.current = element;
      if (typeof forwardedRef === 'function') forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    };

    return (
      <Input
        {...props}
        ref={setInputRef}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        endAdornment={(
          <button
            type="button"
            className={styles.toggle}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setVisible((current) => !current);
              inputRef.current?.focus();
            }}
          >
            {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        )}
      />
    );
  }
);

PasswordInput.displayName = 'PasswordInput';
