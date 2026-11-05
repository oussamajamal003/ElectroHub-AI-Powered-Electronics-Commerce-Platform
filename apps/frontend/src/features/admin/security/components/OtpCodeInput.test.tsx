import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OtpCodeInput, sanitizeOtp } from './OtpCodeInput';

describe('sanitizeOtp', () => {
  it('keeps only the first six digits and drops every other character', () => {
    expect(sanitizeOtp('12 34-56 78')).toBe('123456');
    expect(sanitizeOtp('ab')).toBe('');
  });
});

describe('OtpCodeInput', () => {
  it('reports only digits to its owner', () => {
    const onChange = vi.fn();
    render(<OtpCodeInput id="otp-test" label="6-digit code" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '4a5' } });

    expect(onChange).toHaveBeenLastCalledWith('45');
  });

  it('shows the error text and links it to the field', () => {
    render(<OtpCodeInput id="otp-error" label="6-digit code" value="" onChange={() => undefined} error="That code is not right." />);

    const input = screen.getByLabelText('6-digit code');
    expect(screen.getByText('That code is not right.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
