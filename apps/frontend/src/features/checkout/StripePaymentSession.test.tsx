import { createRef, useEffect, useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripePaymentSession, type PaymentEntryActions } from './StripePaymentSession';
const provider = vi.hoisted(() => ({ submit: vi.fn(), confirm: vi.fn(), mount: vi.fn(), unmount: vi.fn(), options: vi.fn(), elements: vi.fn(),
  ready: true, loadError: false, readyEvent: null as (() => void) | null }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn().mockResolvedValue({}) }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children: React.ReactNode; options: object }) => { provider.elements(options); return children; },
  useStripe: () => ({ confirmPayment: provider.confirm }),
  useElements: () => ({ submit: provider.submit }),
  PaymentElement: (props: { onReady(): void; onLoadError(): void; options: object }) => {
    const initial = useRef(props);
    provider.readyEvent = props.onReady;
    useEffect(() => { provider.mount(); if (provider.loadError) initial.current.onLoadError(); else if (provider.ready) initial.current.onReady(); return () => provider.unmount(); }, []);
    provider.options(props.options); return <div role="note">Mock provider-owned entry</div>;
  },
}));
  beforeEach(() => { vi.clearAllMocks(); provider.ready = true; provider.loadError = false; provider.readyEvent = null; vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_disposable'); provider.submit.mockResolvedValue({}); provider.confirm.mockResolvedValue({ paymentIntent: { status: 'requires_capture' } }); });
function props(visible = true) { return { clientSecret: 'pi_unit_secret_unit', visible, pending: false, onBack: vi.fn(), onContinue: vi.fn(), onError: vi.fn(), children: <h2>Review content</h2> }; }
describe('Production Stripe entry bridge (provider SDK mocked, not real Stripe proof)', () => {
  it('cancels the old readiness deadline when a new secret replaces the session', () => {
    vi.useFakeTimers();
    try {
      provider.ready = false;
      const view = render(<StripePaymentSession {...props()} />);
      act(() => vi.advanceTimersByTime(24_000));
      view.rerender(<StripePaymentSession {...props()} clientSecret="pi_replaced_secret_fixture" />);
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
      act(() => provider.readyEvent?.());
      act(() => vi.advanceTimersByTime(25_000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      view.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('reports a slow provider load as slow, not unavailable, and keeps the skeleton', () => {
    vi.useFakeTimers();
    try {
      provider.ready = false;
      const onRetry = vi.fn();
      const view = render(<StripePaymentSession {...props()} onRetry={onRetry} />);
      act(() => vi.advanceTimersByTime(25_000));
      expect(screen.getByRole('status', { name: 'Loading secure payment form' })).toBeVisible();
      expect(screen.getByText(/taking longer than usual/)).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
      // Measured real readiness reached 30.4 s on a slow link: a late ready is the normal outcome.
      act(() => vi.advanceTimersByTime(6_000)); act(() => provider.readyEvent?.());
      expect(screen.queryByText(/taking longer than usual/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled();
      expect(onRetry).not.toHaveBeenCalled();
      view.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('ends a silent provider stall with a retry that remounts the same secret, without a new payment setup', () => {
    vi.useFakeTimers();
    try {
      provider.ready = false;
      const onRetry = vi.fn();
      const view = render(<StripePaymentSession {...props()} onRetry={onRetry} />);
      act(() => vi.advanceTimersByTime(90_000));
      expect(screen.queryByRole('status', { name: 'Loading secure payment form' })).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('saved payment setup is preserved');
      const mountsBefore = provider.mount.mock.calls.length;
      act(() => screen.getByRole('button', { name: 'Retry secure entry' }).click());
      expect(onRetry).not.toHaveBeenCalled();
      expect(provider.mount.mock.calls.length).toBe(mountsBefore + 1);
      expect(provider.elements.mock.calls.at(-1)?.[0]).toMatchObject({ clientSecret: 'pi_unit_secret_unit' });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      act(() => provider.readyEvent?.());
      expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled();
      view.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('shows one loading skeleton until the provider ready event, then enables Review', () => {
    provider.ready = false;
    render(<StripePaymentSession {...props()} />);
    expect(screen.getAllByRole('status', { name: 'Loading secure payment form' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    act(() => provider.readyEvent?.());
    expect(screen.queryByRole('status', { name: 'Loading secure payment form' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  });
  it('replaces a genuine load failure with compact retry feedback and no skeleton', () => {
    provider.loadError = true; const onRetry = vi.fn(); const input = props();
    render(<StripePaymentSession {...input} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Secure card entry is unavailable.');
    expect(screen.queryByRole('status', { name: 'Loading secure payment form' })).not.toBeInTheDocument();
    expect(input.onError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    screen.getByRole('button', { name: 'Retry secure entry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it('replaces failed Elements with a clean instance for a different attempt secret', () => {
    provider.loadError = true;
    const view = render(<StripePaymentSession {...props()} />);
    expect(screen.getByRole('alert')).toBeVisible();
    provider.loadError = false;
    view.rerender(<StripePaymentSession {...props()} clientSecret="pi_next_secret_fixture" />);
    expect(provider.mount).toHaveBeenCalledTimes(2); expect(provider.unmount).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Order' })).toBeEnabled();
  });
  it('disables provider entrance animations when reduced motion is requested', () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    render(<StripePaymentSession {...props()} />);
    expect(provider.elements).toHaveBeenCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ disableAnimations: true }) }));
    media.mockRestore();
  });
  it('validates without confirming on Review preparation', async () => {
    const ref = createRef<PaymentEntryActions>(); render(<StripePaymentSession {...props()} ref={ref} />);
    let error: string | null | undefined; await act(async () => { error = await ref.current?.validate(); });
    expect(error).toBeNull(); expect(provider.submit).toHaveBeenCalledTimes(1); expect(provider.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(provider.options).toHaveBeenCalledWith(expect.objectContaining({ wallets: { applePay: 'never', googlePay: 'never', link: 'never' } }));
  });
  it('retains the secure entry mount through Review and return to Payment', () => {
    const view = render(<StripePaymentSession {...props()} />);
    view.rerender(<StripePaymentSession {...props(false)} />); view.rerender(<StripePaymentSession {...props(true)} />);
    expect(provider.mount).toHaveBeenCalledTimes(1); expect(provider.unmount).not.toHaveBeenCalled();
    view.unmount(); expect(provider.unmount).toHaveBeenCalledTimes(1);
  });
  it('validates again before final explicit confirm and never puts the secret in the return URL', async () => {
    const ref = createRef<PaymentEntryActions>(); render(<StripePaymentSession {...props()} ref={ref} />);
    await act(async () => { expect(await ref.current?.confirm()).toEqual({ kind: 'confirmed' }); });
    expect(provider.submit.mock.invocationCallOrder[0]).toBeLessThan(provider.confirm.mock.invocationCallOrder[0] ?? 0);
    expect(provider.confirm).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}/checkout?step=review` } }));
    expect(JSON.stringify(provider.confirm.mock.calls)).not.toContain('pi_unit_secret_unit');
  });
  // Regression: a confirmation marker must only be recorded for a confirmation Stripe.js is actually about to send.
  it('announces confirmation only after local validation passes, immediately before Stripe.js confirms', async () => {
    const announce = vi.fn(async () => undefined);
    const ref = createRef<PaymentEntryActions>(); render(<StripePaymentSession {...props()} ref={ref} />);
    await act(async () => { expect(await ref.current?.confirm(announce)).toEqual({ kind: 'confirmed' }); });
    expect(provider.submit.mock.invocationCallOrder[0]).toBeLessThan(announce.mock.invocationCallOrder[0] ?? 0);
    expect(announce.mock.invocationCallOrder[0]).toBeLessThan(provider.confirm.mock.invocationCallOrder[0] ?? 0);
  });
  it('never announces (or confirms) when validation fails, and never confirms when the announcement fails', async () => {
    const announce = vi.fn(async () => undefined);
    provider.submit.mockResolvedValueOnce({ error: { message: 'incomplete' } });
    const ref = createRef<PaymentEntryActions>(); render(<StripePaymentSession {...props()} ref={ref} />);
    await act(async () => { expect(await ref.current?.confirm(announce)).toMatchObject({ kind: 'validation-error' }); });
    expect(announce).not.toHaveBeenCalled(); expect(provider.confirm).not.toHaveBeenCalled();
    await act(async () => { await expect(ref.current!.confirm(async () => { throw new Error('uncertain'); })).rejects.toThrow('uncertain'); });
    expect(provider.confirm).not.toHaveBeenCalled();
  });
  it('does not confirm invalid secure entry', async () => {
    provider.submit.mockResolvedValue({ error: { message: 'sensitive provider message' } });
    const ref = createRef<PaymentEntryActions>(); render(<StripePaymentSession {...props()} ref={ref} />);
    await act(async () => { expect(await ref.current?.confirm()).toEqual({ kind: 'validation-error', message: expect.stringMatching(/highlighted/) }); }); expect(provider.confirm).not.toHaveBeenCalled();
  });
  it.each([['card_error', /could not be authorized/], ['api_connection_error', /not yet known/]] as const)('returns %s for authoritative server reconciliation without claiming Paid', async (type, expected) => {
    provider.confirm.mockResolvedValue({ error: { type, message: 'sensitive provider message' } });
    const ref = createRef<PaymentEntryActions>(); render(<StripePaymentSession {...props()} ref={ref} />);
    await act(async () => { const result = await ref.current?.confirm(); expect(result).toMatchObject({ kind: 'provider-error', message: expect.stringMatching(expected) }); expect(JSON.stringify(result)).not.toContain('sensitive'); });
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
  });
});

it('binds redirect-required verification to the exact saved purchase status URL', async () => {
  const ref = createRef<PaymentEntryActions>();
  render(<StripePaymentSession {...props()} ref={ref} returnPath="/account/payment-status/attempt-a" actionLabel="Pay USD 199.00" />);
  await act(async () => { await ref.current!.confirm(); });
  expect(provider.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmParams: {
    return_url: `${window.location.origin}/account/payment-status/attempt-a` }, redirect: 'if_required' }));
  expect(screen.getByRole('button', { name: 'Pay USD 199.00' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Review Order' })).not.toBeInTheDocument();
});
