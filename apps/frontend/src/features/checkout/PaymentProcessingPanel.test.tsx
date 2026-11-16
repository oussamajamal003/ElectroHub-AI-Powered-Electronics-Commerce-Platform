import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CheckingPayment, CheckoutProcessing } from './CheckoutComponents';

describe('Payment processing presentation', () => {
  it('keeps card confirmation pending without success claims or timer-driven progress', () => {
    vi.useFakeTimers();
    try {
      render(<CheckoutProcessing browserConfirming />);
      const stages = screen.getByRole('list', { name: 'Payment processing stages' });
      expect(within(stages).getByText('Secure submission').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(within(stages).getByText('Order confirmation').closest('li')).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('status')).toHaveTextContent('Keep this page open');
      act(() => vi.advanceTimersByTime(300_000));
      expect(screen.getByText('Card confirmation in progress')).toBeInTheDocument();
      expect(screen.queryByText(/payment successful|payment confirmed|100%/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('changes the active visual stage only when the caller changes the phase', () => {
    const { rerender } = render(<CheckoutProcessing browserConfirming />);
    rerender(<CheckoutProcessing />);
    expect(screen.getByText('Provider verification').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Secure submission').closest('li')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Order confirmation').closest('li')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('status')).toHaveTextContent('You can continue shopping');
    expect(screen.queryByText(/Keep this page open/)).not.toBeInTheDocument();
  });

  it('preserves the same-attempt check and blocks duplicate clicks while a check is pending', () => {
    const onCheck = vi.fn();
    const { rerender } = render(<MemoryRouter><CheckingPayment unconfirmed onCheck={onCheck} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('This isn’t a payment failure');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    rerender(<MemoryRouter><CheckingPayment unconfirmed checking onCheck={onCheck} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/products');
    expect(screen.queryByRole('button', { name: /pay|retry|place order/i })).not.toBeInTheDocument();
  });

  it('announces server checking copy and escaped notes without claiming order confirmation', () => {
    render(<MemoryRouter><CheckingPayment note="<script>unsafe</script>" /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Your payment was submitted.');
    expect(screen.getByText('<script>unsafe</script>')).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByText(/payment successful/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
