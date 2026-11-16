import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpVerification } from './OtpVerification';

describe('OtpVerification Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Renders 6 digit inputs, brand, title, and verify button', () => {
    render(
      <OtpVerification
        email="customer@example.com"
        title="Verify your email"
      />
    );

    expect(screen.getByText('ElectroHub')).toBeInTheDocument();
    expect(screen.getByText('Verify your email')).toBeInTheDocument();
    expect(screen.getByText('customer@example.com')).toBeInTheDocument();

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(6);

    const submitBtn = screen.getByRole('button', { name: /verify/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toBeDisabled(); // Disabled because 0 digits entered
  });

  it('2. Has mobile-friendly input attributes: inputmode=numeric, autocomplete=one-time-code', () => {
    render(<OtpVerification />);
    const inputs = screen.getAllByRole('textbox');

    inputs.forEach((input) => {
      expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(input).toHaveAttribute('autocomplete', 'one-time-code');
      expect(input).toHaveAttribute('maxlength', '1');
    });
  });

  it('3. Auto-advances focus to next input on typing', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<OtpVerification onChange={handleChange} />);

    const inputs = screen.getAllByRole('textbox');

    await user.type(inputs[0]!, '4');
    expect(handleChange).toHaveBeenCalledWith('4');
    expect(inputs[1]!).toHaveFocus();

    await user.type(inputs[1]!, '8');
    expect(handleChange).toHaveBeenCalledWith('48');
    expect(inputs[2]!).toHaveFocus();
  });

  it('4. Filters out non-numeric characters', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<OtpVerification onChange={handleChange} />);

    const inputs = screen.getAllByRole('textbox');

    await user.type(inputs[0]!, 'a');
    expect(inputs[0]!).toHaveValue('');
    expect(handleChange).not.toHaveBeenCalledWith('a');

    await user.type(inputs[0]!, '$');
    expect(inputs[0]!).toHaveValue('');

    await user.type(inputs[0]!, '7');
    expect(inputs[0]!).toHaveValue('7');
    expect(handleChange).toHaveBeenCalledWith('7');
  });

  it('5. Supports paste of 6-digit code across all inputs', () => {
    const handleChange = vi.fn();
    render(<OtpVerification onChange={handleChange} />);

    const inputs = screen.getAllByRole('textbox');

    fireEvent.paste(inputs[0]!, {
      clipboardData: {
        getData: () => '483921',
      },
    });

    expect(handleChange).toHaveBeenCalledWith('483921');
    expect(inputs[0]!).toHaveValue('4');
    expect(inputs[1]!).toHaveValue('8');
    expect(inputs[2]!).toHaveValue('3');
    expect(inputs[3]!).toHaveValue('9');
    expect(inputs[4]!).toHaveValue('2');
    expect(inputs[5]!).toHaveValue('1');
  });

  it('6. Backspace clears current digit or moves focus to previous digit', () => {
    const handleChange = vi.fn();
    render(<OtpVerification value="48" onChange={handleChange} />);

    const inputs = screen.getAllByRole('textbox');

    // Focus on index 2 (empty)
    inputs[2]!.focus();
    fireEvent.keyDown(inputs[2]!, { key: 'Backspace' });

    // Should focus index 1 and clear it
    expect(inputs[1]!).toHaveFocus();
    expect(handleChange).toHaveBeenCalledWith('4');
  });

  it('preserves later digits when pasting into the middle', () => {
    const handleChange = vi.fn();
    render(<OtpVerification value="123456" onChange={handleChange} />);

    fireEvent.paste(screen.getAllByRole('textbox')[2]!, {
      clipboardData: { getData: () => '89' },
    });

    expect(handleChange).toHaveBeenCalledWith('128956');
  });

  it('7. Delete key clears current digit', () => {
    const handleChange = vi.fn();
    render(<OtpVerification value="48" onChange={handleChange} />);

    const inputs = screen.getAllByRole('textbox');

    inputs[0]!.focus();
    fireEvent.keyDown(inputs[0]!, { key: 'Delete' });

    expect(handleChange).toHaveBeenCalledWith(' 8');
  });

  it('8. ArrowLeft and ArrowRight navigate between inputs', () => {
    render(<OtpVerification value="123456" />);
    const inputs = screen.getAllByRole('textbox');

    inputs[2]!.focus();
    expect(inputs[2]!).toHaveFocus();

    fireEvent.keyDown(inputs[2]!, { key: 'ArrowLeft' });
    expect(inputs[1]!).toHaveFocus();

    fireEvent.keyDown(inputs[1]!, { key: 'ArrowRight' });
    expect(inputs[2]!).toHaveFocus();
  });

  it('preserves digit positions when clearing a middle slot with Delete', () => {
    const handleChange = vi.fn();
    render(<OtpVerification value="123456" onChange={handleChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.keyDown(inputs[2]!, { key: 'Delete' });
    expect(handleChange).toHaveBeenCalledWith('12 456');
  });

  it('does not submit an incomplete code when Enter is pressed', () => {
    const handleSubmit = vi.fn();
    render(<OtpVerification value="12345" onSubmit={handleSubmit} />);
    fireEvent.keyDown(screen.getAllByRole('textbox')[4]!, { key: 'Enter' });
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('submits a complete code with Enter and prevents duplicate in-flight submissions', () => {
    const handleSubmit = vi.fn(() => new Promise<void>(() => undefined));
    render(<OtpVerification value="483921" onSubmit={handleSubmit} />);
    const lastInput = screen.getAllByRole('textbox')[5]!;
    fireEvent.keyDown(lastInput, { key: 'Enter' });
    fireEvent.keyDown(lastInput, { key: 'Enter' });
    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith('483921');
  });

  it('9. Enables Verify button when 6 digits are complete, and submits code', async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();
    render(<OtpVerification value="483921" onSubmit={handleSubmit} />);

    const submitBtn = screen.getByRole('button', { name: /verify/i });
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);
    expect(handleSubmit).toHaveBeenCalledWith('483921');
  });

  it('10. Renders loading state and disables inputs and submit button', () => {
    render(<OtpVerification value="483921" loading={true} />);

    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });

    const submitBtn = screen.getByRole('button', { name: /verifying/i });
    expect(submitBtn).toBeDisabled();
  });

  it('11. Renders error message and error styles', () => {
    render(<OtpVerification error="Invalid verification code" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid verification code');

    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input) => {
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('12. Renders expired state message and disables submission', () => {
    const handleSubmit = vi.fn();
    render(<OtpVerification value="483921" expired={true} onSubmit={handleSubmit} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/code expired/i);
    const submitBtn = screen.getByRole('button', { name: /verify/i });
    expect(submitBtn).toBeDisabled();
  });

  it('13. Renders locked state message and disables all inputs', () => {
    render(<OtpVerification value="483921" locked={true} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i);
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
  });

  it('14. Renders countdown and enables Resend Code button when timer finishes', () => {
    vi.useFakeTimers();
    const handleResend = vi.fn();

    render(
      <OtpVerification
        resendCountdownSeconds={3}
        onResend={handleResend}
      />
    );

    // Initial state: countdown active
    expect(screen.getByText('Resend available in 3s')).toBeInTheDocument();

    // Advance 1s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Resend available in 2s')).toBeInTheDocument();

    // Advance 2s to reach 0
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const resendBtn = screen.getByRole('button', { name: /resend code/i });
    expect(resendBtn).toBeEnabled();

    fireEvent.click(resendBtn);
    expect(handleResend).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('15. Renders Back to Login button when prop provided', async () => {
    const user = userEvent.setup();
    const handleBack = vi.fn();
    render(<OtpVerification onBackToLogin={handleBack} />);

    const backBtn = screen.getByRole('button', { name: /back to login/i });
    expect(backBtn).toBeInTheDocument();

    await user.click(backBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });
});
