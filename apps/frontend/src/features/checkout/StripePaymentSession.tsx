import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type ReactNode } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { stripeClient } from './stripeClient';
import { PaymentSkeleton, PaymentStep } from './CheckoutComponents';
import { markPaymentTiming } from './paymentTiming';
import { Button } from '@/components/ui/Button';
import styles from './Checkout.module.scss';

// Measured real Payment Element readiness on a slow (~85 KB/s) link: 24.1-30.4 s from a cold cache.
// A slow load is reported as slow; only a stall well beyond that is reported as unavailable.
const ENTRY_SLOW_NOTICE_MS = 25_000;
const ENTRY_STALL_DEADLINE_MS = 90_000;
export type PaymentConfirmation = { kind: 'confirmed' } | { kind: 'validation-error' | 'provider-error'; message: string };
/** `beforeProvider` runs only after local validation passed, immediately before Stripe.js is asked to confirm; if it throws, nothing is confirmed. */
/** `instance` identifies one mounted secure-entry form; it is stable for that mount even when the handle object is rebuilt. */
export interface PaymentEntryActions { readonly instance?: symbol; validate(): Promise<string | null>; confirm(beforeProvider?: () => Promise<void>): Promise<PaymentConfirmation> }
interface Props { clientSecret: string; timingAttemptId?: string; visible: boolean; pending: boolean; canContinue?: boolean; actionLabel?: string; paymentNotice?: string; returnPath?: string; onBack(): void; onContinue(): void;
  onError(message: string): void; onRetry?(): void; children: ReactNode }
type EntryProps = Omit<Props, 'clientSecret'> & { onRemount(): void };
const Entry = forwardRef<PaymentEntryActions, EntryProps>(function Entry(props, ref) {
  const stripe = useStripe(); const elements = useElements(); const [ready, setReady] = useState(false);
  const [instance] = useState(() => Symbol('secure-entry'));
  // 'stalled': no ready/error from the provider in time; the same secret is still valid. 'load-error': provider-reported.
  const [failed, setFailed] = useState<false | 'stalled' | 'load-error'>(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => { markPaymentTiming('elements-mounted', { attemptId: props.timingAttemptId ?? null }); }, [props.timingAttemptId]);
  useEffect(() => {
    if (ready || failed) return;
    const notice = window.setTimeout(() => { markPaymentTiming('payment-element-slow'); setSlow(true); }, ENTRY_SLOW_NOTICE_MS);
    const stall = window.setTimeout(() => {
      markPaymentTiming('payment-element-ready-timeout');
      setFailed('stalled');
    }, ENTRY_STALL_DEADLINE_MS);
    return () => { window.clearTimeout(notice); window.clearTimeout(stall); };
  }, [ready, failed]);
  // A stall keeps the same client secret: remount the provider frame only, no new payment setup request.
  const retry = failed === 'stalled' || !props.onRetry ? props.onRemount : props.onRetry;
  useEffect(() => { if (stripe && elements) markPaymentTiming('elements-context-ready'); }, [stripe, elements]);
  useImperativeHandle(ref, () => ({
    instance,
    async validate() {
      if (!stripe || !elements || !ready) return 'Secure card entry is still loading.';
      const result = await elements.submit();
      return result.error ? 'Check the payment details highlighted in the secure card form.' : null;
    },
    async confirm(beforeProvider) {
      if (!stripe || !elements || !ready) return { kind: 'validation-error', message: 'Secure card entry is still loading.' };
      const validation = await elements.submit();
      if (validation.error) return { kind: 'validation-error', message: 'Check the payment details highlighted in the secure card form.' };
      await beforeProvider?.();
      // No browser status is trusted as payment success. The owned server attempt is reconciled afterward.
      const result = await stripe.confirmPayment({ elements, confirmParams: {
        return_url: `${window.location.origin}${props.returnPath ?? '/checkout?step=review'}` }, redirect: 'if_required' });
      if (!result.error) return { kind: 'confirmed' };
      return { kind: 'provider-error', message: result.error.type === 'card_error' || result.error.type === 'validation_error'
        ? 'The card could not be authorized. Check the secure card form or try another card.'
        : 'The payment outcome is not yet known. Check the existing attempt before trying again.' };
    },
  }), [instance, stripe, elements, ready, props.returnPath]);
  return <><div hidden={!props.visible}><PaymentStep actionLabel={props.actionLabel} paymentNotice={props.paymentNotice} ready={ready && Boolean(stripe)} canContinue={props.canContinue} pending={props.pending}
    onBack={props.onBack} onContinue={props.onContinue}>
    <div className={styles.elementWrapper}>
      <div className={ready ? styles.elementVisible : styles.elementHidden}>
        <PaymentElement options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' } }}
          onLoaderStart={() => markPaymentTiming('payment-element-loader-start')}
          onReady={() => { markPaymentTiming('payment-element-ready', { attemptId: props.timingAttemptId ?? null }); setReady(true); setFailed(false); setSlow(false); }} onLoadError={() => { markPaymentTiming('payment-element-load-error'); setReady(false); setFailed('load-error'); props.onError('Secure card entry could not load. Retry payment setup.'); }} />
      </div>
      {!ready && !failed && (
        <div className={styles.elementSkeletonOverlay}>
          <PaymentSkeleton />
        </div>
      )}
    </div>
    {slow && !ready && !failed && <div role="status" className={styles.inlineNotice}><p>Secure card entry is taking longer than usual to load. It will appear here as soon as it is ready.</p>
      <Button size="small" variant="outline" onClick={props.onRemount}>Reload secure entry</Button></div>}
    {failed === 'stalled' && <div role="alert" className={styles.providerError}><p>Secure card entry has not finished loading.</p><p>This can happen on a slow connection. Retry to reload it. Your saved payment setup is preserved.</p><Button size="small" onClick={retry}>Retry secure entry</Button></div>}
    {failed === 'load-error' && <div role="alert" className={styles.providerError}><p>Secure card entry is unavailable.</p><p>The card form could not be loaded. Retry secure entry. Your saved payment setup is preserved.</p><Button size="small" onClick={retry}>Retry secure entry</Button></div>}
  </PaymentStep></div>{props.children}</>;
});

/** Keep the same Elements and secure iframe mounted through Review and 3DS. Secrets remain only in memory. */
export const StripePaymentSession = forwardRef<PaymentEntryActions, Props>(function StripePaymentSession({ clientSecret, ...props }, ref) {
  const [stripe, setStripe] = useState(stripeClient);
  const [failed, setFailed] = useState(false);
  // Bumping the epoch gives Elements a fresh frame for the SAME secret (no payment setup request).
  const [mountEpoch, setMountEpoch] = useState(0);
  const remount = () => { setFailed(false); setStripe(stripeClient()); setMountEpoch(value => value + 1); };
  useEffect(() => { let active = true; if (stripe) void stripe.then(value => { if (active && !value) setFailed(true); }); return () => { active = false; }; }, [stripe]);
  const options = useMemo<StripeElementsOptions>(() => ({ clientSecret, appearance: { theme: 'stripe',
    disableAnimations: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    variables: { colorPrimary: '#2563EB', fontFamily: 'Poppins, sans-serif', borderRadius: '0px' } } }), [clientSecret]);
  if (!stripe || failed) return <><div hidden={!props.visible}><PaymentStep ready={false} pending={props.pending} onBack={props.onBack} onContinue={props.onContinue}>
    <div role="alert" className={styles.providerError}><p>Secure card entry could not load. Please retry.</p><Button size="small" onClick={remount}>Retry secure entry</Button></div>
  </PaymentStep></div>{props.children}</>;
  // Elements options are immutable; a different attempt owns a fresh secure entry instance.
  return <Elements key={`${clientSecret}:${mountEpoch}`} stripe={stripe} options={options}><Entry {...props} onRemount={remount} ref={ref} /></Elements>;
});
