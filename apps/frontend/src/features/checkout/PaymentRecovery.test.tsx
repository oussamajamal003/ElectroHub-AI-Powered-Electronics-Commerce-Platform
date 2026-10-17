import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { cart } from './fixtures';
import type { PaymentOutcome, PaymentState } from './types';
import { PaymentRecovery } from './PaymentRecovery';

function makeOutcome(state: PaymentState, recoveryActive = false): PaymentOutcome {
  return {
    attemptId: 'attempt-1', state, providerStatus: null, failureCode: null,
    total: '1.00', currency: 'USD', orderReference: null, committed: false,
    cart, confirmation: null, recoveryRemainder: null, recoveryActive,
  };
}

describe('PaymentRecovery actions', () => {
  it('processing state renders accessible progress with safe shopping navigation and accessible role', () => {
    render(
      <MemoryRouter>
        <PaymentRecovery outcome={null} message="" pending={true} onCheck={vi.fn()} onRetry={vi.fn()} />
      </MemoryRouter>
    );

    const statusSection = screen.getByRole('status');
    expect(statusSection).toBeVisible();
    expect(statusSection).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();
    expect(screen.getByText("Your payment was submitted. We’re confirming the result with our payment provider.")).toBeVisible();

    // ZERO action buttons
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check payment status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Return to Cart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
  });

  it.each(['PROCESSING', 'CAPTURE_PENDING', 'PREPARING', 'AUTHORIZED'] as const)(
    'slow reconciliation in %s renders accessible progress without duplicate payment actions',
    state => {
      render(
        <MemoryRouter>
          <PaymentRecovery outcome={makeOutcome(state)} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} />
        </MemoryRouter>
      );

      const statusSection = screen.getByRole('status');
      expect(statusSection).toBeVisible();
      expect(statusSection).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();

      // ZERO action buttons
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Check payment status' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Return to Cart' })).not.toBeInTheDocument();
    }
  );

  it('keeps a stale AWAITING_INPUT snapshot in Processing while the backend says reconciliation is active', () => {
    render(
      <MemoryRouter>
        <PaymentRecovery outcome={makeOutcome('AWAITING_INPUT', true)} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Return to Cart' })).not.toBeInTheDocument();
  });

  it('does not treat a stale DECLINED snapshot as a final failure during active recovery', () => {
    render(
      <MemoryRouter>
        <PaymentRecovery outcome={makeOutcome('DECLINED', true)} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
  });
  it('never replaces Checking with the unwanted timer-driven recovery screen', () => {
    vi.useFakeTimers();
    try {
      render(<MemoryRouter><PaymentRecovery outcome={makeOutcome('CAPTURE_PENDING')} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} /></MemoryRouter>);
      act(() => vi.advanceTimersByTime(300_000));
      expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();
      expect(screen.queryByText(/verification is taking longer/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/products');
    } finally { vi.useRealTimers(); }
  });

  it('confirmed DECLINED failure renders failure screen with TWO enabled working buttons', () => {
    const onRetry = vi.fn();
    const onLeave = vi.fn();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <PaymentRecovery outcome={makeOutcome('DECLINED')} message="" pending={false} onCheck={vi.fn()} onRetry={onRetry} onLeave={onLeave} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    expect(screen.getByText('Your payment was declined. Please check your card details or try a different card.')).toBeVisible();
    expect(screen.getByText('Payment not processed')).toBeVisible();
    expect(screen.getByText('Your purchase has been preserved. You can try again or use another card.')).toBeVisible();

    const tryAgainBtn = screen.getByRole('button', { name: 'Try Again' });
    const returnCartLink = screen.getByRole('link', { name: 'Return to Cart' });

    expect(tryAgainBtn).toBeVisible();
    expect(tryAgainBtn).toBeEnabled();
    expect(returnCartLink).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check payment status' })).not.toBeInTheDocument();

    fireEvent.click(tryAgainBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    fireEvent.click(returnCartLink);
    expect(onLeave).toHaveBeenCalledTimes(1);

    scrollTo.mockRestore();
  });

  it('AWAITING_INPUT is not evidence of failure and stays in Checking without retry or false decline messaging', () => {
    const onRetry = vi.fn();
    const onLeave = vi.fn();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <PaymentRecovery outcome={makeOutcome('AWAITING_INPUT')} message="" pending={false} onCheck={vi.fn()} onRetry={onRetry} onLeave={onLeave} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
    expect(screen.queryByText('Payment not processed')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment needs a different card')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled(); expect(onLeave).not.toHaveBeenCalled();

    scrollTo.mockRestore();
  });

  it('runs the leave cleanup synchronously for confirmed failure but not while payment is pending', () => {
    const onLeave = vi.fn();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const view = render(
      <MemoryRouter>
        <PaymentRecovery outcome={makeOutcome('DECLINED')} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} onLeave={onLeave} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('link', { name: 'Return to Cart' }));
    expect(onLeave).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter>
        <PaymentRecovery outcome={makeOutcome('CAPTURE_PENDING')} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} onLeave={onLeave} />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /Checking your payment/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Return to Cart' })).not.toBeInTheDocument();
    expect(onLeave).toHaveBeenCalledTimes(1);
    scrollTo.mockRestore();
  });

  it('a settled check without a result shows a truthful unconfirmed state with a same-attempt check, never permanent checking or failure', () => {
    const onCheck = vi.fn(); const onRetry = vi.fn();
    render(<MemoryRouter><PaymentRecovery outcome={makeOutcome('PROCESSING')} message="Payment status could not be checked." pending={false} onCheck={onCheck} onRetry={onRetry} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Checking your payment/ })).not.toBeInTheDocument();
    expect(screen.getByText(/This isn’t a payment failure/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Payment Failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheck).toHaveBeenCalledTimes(1); expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/products');
  });

  it('UNKNOWN classification keeps the attempt in the unconfirmed state, and a running check disables the action', () => {
    const outcome: PaymentOutcome = { ...makeOutcome('PROCESSING'), classification: 'UNKNOWN' };
    render(<MemoryRouter><PaymentRecovery outcome={outcome} message="" pending={true} onCheck={vi.fn()} onRetry={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'We couldn’t confirm your payment yet' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeDisabled();
  });
});

// Task 03.6 product decision: "Restore items" is never offered as a substitute for resolving a submitted payment.
describe('PaymentRecovery for a payment that did not complete', () => {
  it.each(['CANCELED', 'COMPENSATED', 'REFUNDED'] as const)('never offers Restore items (%s), for Cart or Buy Now', state => {
    const submittedAt = new Date().toISOString();
    for (const scope of ['CART_CHECKOUT', 'BUY_NOW'] as const) {
      const view = render(<MemoryRouter><PaymentRecovery outcome={{ ...makeOutcome(state), submittedAt, scope }} message="" pending={false} onCheck={vi.fn()} onRetry={vi.fn()} /></MemoryRouter>);
      expect(screen.queryByRole('button', { name: /Restore items/ })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
