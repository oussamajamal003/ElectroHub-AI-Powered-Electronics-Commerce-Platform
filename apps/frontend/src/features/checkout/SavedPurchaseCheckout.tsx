import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { CheckingPayment, CheckoutProcessing, CheckoutStepper, SavedPurchaseSummary } from './CheckoutComponents';
import { StripePaymentSession, type PaymentEntryActions } from './StripePaymentSession';
import { PaymentRecovery } from './PaymentRecovery';
import { PaymentResumeError, resumeSavedPayment, type SavedRetrySetup } from './paymentResume';
import { CHECKOUT_RECOVERY_WINDOW_MS, canResumePaymentEntry, hasVerifiedPayment, isResolvedPayment } from './paymentPresentation';
import { acknowledgePaymentOutcome, isNotifiableOutcome, synchronizePaymentOutcome, usePresentedPaymentAttempt } from './PaymentPurchases';
import { usePaymentLock } from './PaymentLockContext';
import { markPaymentTiming } from './paymentTiming';
import { rememberPurchaseEntries } from './state';
import { beginPaymentObservation, endPaymentObservation, isPreviousPaymentResult, observedPaymentIds, observePaymentSnapshot, usePaymentObservations } from './paymentObservation';
import type { CheckoutStep, PaymentOutcome } from './types';
import styles from './Checkout.module.scss';

const endpoint = '/api/checkout/payment-attempts';
// Bounded wait for a routine recovery pass to finish (observed in DEV: p50 4.3 s, p90 10.6 s, max 26.3 s). Past the deadline the page keeps
// the existing safe observation instead of opening card entry.
const LEASE_SETTLE_DEADLINE_MS = 20_000;
const LEASE_SETTLE_INTERVAL_MS = 1_000;
const steps: CheckoutStep[] =['shipping', 'delivery', 'payment', 'review'];
const money = (value: string, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
type Load = { kind: 'loading' } | { kind: 'ready'; saved: SavedRetrySetup } | { kind: 'observing' } | { kind: 'unverified' } | { kind: 'ineligible'; changed: boolean };

/**
 * Pays a submitted, backend-confirmed failed purchase again from its OWN saved snapshot.
 * Identity, items, shipping, delivery and total come only from the authoritative `resume` response
 * (same attempt and PaymentIntent, eligibility and pricing revalidated server-side). The active Cart,
 * Checkout B's draft and browser storage are never read or written here.
 */
export function SavedPurchaseCheckout({ attemptId }: { attemptId: string }) {
  const { user, isSessionVerified } = useAuth(); const userId = user?.id ?? '';
  const navigate = useNavigate(); const location = useLocation(); const client = useQueryClient(); const { setPaymentState } = usePaymentLock();
  const [params, setParams] = useSearchParams();
  const requested = params.get('step') as CheckoutStep | null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' }); const [epoch, setEpoch] = useState(0);
  const [phase, setPhase] = useState<'entry' | 'processing' | 'result'>('entry');
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [message, setMessage] = useState(''); const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);
  // Review belongs to this secure-entry instance, never a persisted URL or a prior card.
  const step: CheckoutStep = requested === 'review' && !ready ? 'payment' : requested && steps.includes(requested) ? requested : 'payment';
  const entry = useRef<PaymentEntryActions>(null); const busy = useRef(false); const generation = useRef(0);
  const started = useRef(Date.now());
  usePaymentObservations();

  useEffect(() => {
    if (!isSessionVerified || !userId) return;
    const current = ++generation.current; setLoad({ kind: 'loading' }); setPhase('entry'); setOutcome(null); setMessage(''); setReady(false);
    const observe = (result: PaymentOutcome) => {
      if (generation.current !== current) return;
      setLoad({ kind: 'observing' }); settle(result);
    };
    const read = async () => {
      const result = (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attemptId}`, { signal: AbortSignal.timeout(10_000) })).data;
      if (result.attemptId !== attemptId) throw new PaymentResumeError('identity');
      return result;
    };
    // A routine recovery read (worker or Cart poll) holds a lease for several seconds and reports recoveryActive. That is not a payment in
    // flight: wait it out (bounded) before deciding, instead of observing a saved card entry until the recovery window lapses.
    const readSettled = async () => {
      const deadline = Date.now() + LEASE_SETTLE_DEADLINE_MS;
      let result = await read();
      while (Date.now() < deadline && result.recoveryActive && canResumePaymentEntry({ ...result, recoveryActive: false })) {
        await new Promise(resolve => window.setTimeout(resolve, LEASE_SETTLE_INTERVAL_MS));
        if (generation.current !== current) return result;
        result = await read();
      }
      return result;
    };
    void (async () => {
      try {
        // Router state survives Refresh/Back. It names a purchase, not permission to pay it again.
        const latest = await readSettled();
        if (generation.current !== current) return;
        // A NEW backend decline supersedes an old submission marker. The unchanged
        // pre-confirmation decline must still remain under observation.
        observePaymentSnapshot(userId, latest);
        if (observedPaymentIds(userId).has(attemptId) || !canResumePaymentEntry(latest)) { observe(latest); return; }
        try {
          const saved = await resumeSavedPayment(userId, attemptId);
          if (generation.current !== current) return;
          if (latest.intentId && saved.intentId && latest.intentId !== saved.intentId) throw new PaymentResumeError('identity');
          if (!canResumePaymentEntry(saved)) observe(saved);
          else setLoad({ kind: 'ready', saved });
        } catch (error) {
          if (generation.current !== current) return;
          if (!(error instanceof PaymentResumeError) || error.kind !== 'ineligible') throw error;
          // Eligibility can race a worker/webhook. Re-read before interpreting any 409 as a rejection.
          const result = await readSettled();
          if (generation.current !== current) return;
          if (error.code === 'PAYMENT_RECOVERY_PENDING' && result.state === 'DECLINED') {
            // The provider/worker can be ahead of this row's old decline. A recovery
            // conflict is not a newly confirmed decline and must not invite another charge.
            beginPaymentObservation(userId, result);
            observe(result); setMessage('unconfirmed'); return;
          }
          if (error.code !== 'CHECKOUT_CHANGED' || !canResumePaymentEntry(result)) observe(result);
          else setLoad({ kind: 'ineligible', changed: true });
        }
      } catch { if (generation.current === current) setLoad({ kind: 'unverified' }); }
    })();
    return () => { generation.current = current + 1; };
    // Identity/explicit retry owns this load; settle is an imperative, generation-fenced action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, userId, isSessionVerified, epoch]);

  useEffect(() => {
    if (load.kind === 'ready' && phase === 'entry' && requested === 'review' && !ready) {
      setParams({ step: 'payment' }, { replace: true, state: { retryPurchase: attemptId } });
    }
  }, [load.kind, phase, requested, ready, attemptId, setParams]);

  usePresentedPaymentAttempt(phase === 'entry' ? null : attemptId);
  const unresolved = phase === 'result' && (!outcome || !isResolvedPayment(outcome) || isPreviousPaymentResult(userId, outcome));
  // A saved purchase being verified is read, never re-submitted.
  const status = useQuery({ queryKey: ['saved-payment-status', userId, attemptId, epoch], enabled: unresolved && isSessionVerified,
    queryFn: async ({ signal }) => (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attemptId}`, { signal })).data,
    refetchInterval: 3_000, retry: false, staleTime: 0 });
  useEffect(() => { if (unresolved && status.isFetchedAfterMount && !status.isFetching && status.data && status.data.attemptId === attemptId) settle(status.data); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status.data, status.isFetchedAfterMount, status.isFetching, unresolved]);
  useEffect(() => {
    if (!unresolved) return;
    const timer = window.setTimeout(() => { setPaymentState('IDLE'); navigate(`/cart?purchase=${attemptId}`, { replace: true }); },
      Math.max(0, CHECKOUT_RECOVERY_WINDOW_MS - (Date.now() - started.current)));
    return () => window.clearTimeout(timer);
  }, [unresolved, attemptId, navigate, setPaymentState]);
  useEffect(() => {
    if (phase === 'result' && outcome && userId && !isPreviousPaymentResult(userId, outcome) && isResolvedPayment(outcome) && !outcome.recoveryActive && isNotifiableOutcome(outcome)) acknowledgePaymentOutcome(userId, outcome, client);
  }, [phase, outcome, userId, client]);
  useEffect(() => () => setPaymentState('IDLE'), [setPaymentState]);

  function settle(result: PaymentOutcome) {
    if (result.attemptId !== attemptId || load.kind === 'ready' && load.saved.intentId && result.intentId && result.intentId !== load.saved.intentId) return;
    observePaymentSnapshot(userId, result);
    if (!isPreviousPaymentResult(userId, result)) setMessage('');
    synchronizePaymentOutcome(userId, result, client);
    setOutcome(result); setPhase('result');
    setPaymentState(result.recoveryActive ? 'COMMITTING_ORDER' : 'IDLE');
    if (hasVerifiedPayment(result) && result.confirmation) {
      const orderRef = result.confirmation.orderReference;
      acknowledgePaymentOutcome(userId, result, client);
      client.setQueryData(queryKeys.orders.confirmation(userId, orderRef), { data: result.confirmation });
      void client.invalidateQueries({ queryKey: ['payment-purchases', userId] });
      setPaymentState('IDLE');
      navigate(`/checkout/confirmation/${orderRef}`, { replace: true });
    }
  }
  // The purchase identity travels with every step (router state), so Back/edit never loses it.
  const go = (next: CheckoutStep) => {
    if (next === 'payment') setReady(false);
    setParams({ step: next }, { state: { retryPurchase: attemptId } });
  };
  const place = async () => {
    if (busy.current || !ready || step !== 'review' || load.kind !== 'ready' || !entry.current) return;
    busy.current = true; const current = generation.current;
    window.scrollTo({ top: 0, behavior: 'instant' });
    setMessage(''); setPhase('processing'); started.current = Date.now(); setPaymentState('CONFIRMING_PAYMENT');
    try {
      markPaymentTiming('authorization-start', { attemptId });
      beginPaymentObservation(userId, load.saved);
      rememberPurchaseEntries(userId, load.saved.scope ?? 'CART_CHECKOUT', [location.key], attemptId);
      const confirmation = await entry.current.confirm();
      if (confirmation.kind === 'validation-error') {
        endPaymentObservation(userId, attemptId);
        if (current === generation.current) { setPhase('entry'); setPaymentState('IDLE'); setMessage(confirmation.message); go('payment'); }
        return;
      }
      if (current === generation.current) setPaymentState('COMMITTING_ORDER');
      // Finish the one authorized handoff even if the customer leaves during Stripe confirmation.
      const result = (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attemptId}/reconcile`, { method: 'POST', data: {} })).data;
      if (result.attemptId !== attemptId || load.saved.intentId && result.intentId && result.intentId !== load.saved.intentId) return;
      if (isResolvedPayment(result) && !result.recoveryActive) endPaymentObservation(userId, attemptId);
      // Global cache updates survive navigation; only this still-mounted screen may acknowledge/navigate.
      if (current === generation.current) settle(result);
      else synchronizePaymentOutcome(userId, result, client);
    } catch {
      // Unknown, never failure: the same attempt is checked again, never paid again.
      if (current === generation.current) { setOutcome(null); setPhase('result'); setMessage('unconfirmed'); setPaymentState('IDLE'); }
    } finally { busy.current = false; void client.invalidateQueries({ queryKey: ['payment-purchases', userId] }); }
  };
  const check = async () => {
    if (checking) return;
    setChecking(true);
    const current = generation.current;
    try {
      const result = (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attemptId}/reconcile`, { method: 'POST', data: {} })).data;
      if (result.attemptId !== attemptId) return;
      if (isResolvedPayment(result) && !result.recoveryActive) endPaymentObservation(userId, attemptId);
      if (current === generation.current) { settle(result); setMessage(''); }
      else synchronizePaymentOutcome(userId, result, client);
    }
    catch { setMessage('unconfirmed'); }
    finally { setChecking(false); }
  };

  if (!isSessionVerified || load.kind === 'loading') return <ElectroHubLoader page />;
  if (phase === 'result') {
    if (!outcome || !isResolvedPayment(outcome) || isPreviousPaymentResult(userId, outcome)) return <div className={styles.processingWrapper}>
      <CheckingPayment unconfirmed={message === 'unconfirmed' || outcome?.classification === 'UNKNOWN'} checking={checking} onCheck={() => void check()} /></div>;
    return <div className={styles.recoveryWrapper}><PaymentRecovery outcome={outcome} message="" pending={false}
      onCheck={() => void check()} onRetry={() => { endPaymentObservation(userId, attemptId); go('payment'); setEpoch(value => value + 1); }} /></div>;
  }
  if (load.kind !== 'ready') {
    return <div className={styles.processingWrapper}><section className={styles.paymentRecovery} aria-labelledby="saved-unavailable-heading">
      <h1 id="saved-unavailable-heading">{load.kind === 'ineligible' ? 'This purchase can’t be paid again right now' : 'We couldn’t load this saved purchase'}</h1>
      <div className={styles.notice} role="status"><p>{load.kind === 'ineligible'
        ? 'Prices, availability or delivery terms changed. Review this saved purchase in Cart before trying again.'
        : 'We couldn’t verify the current payment status. Please don’t pay again until it has been checked. Your saved purchase remains available in Cart or Orders.'}</p></div>
      <div className={styles.recoveryActions}>
        {load.kind === 'unverified' && <Button onClick={() => setEpoch(value => value + 1)}>Try again</Button>}
        <Link className={styles.secondaryLink} to="/cart">Return to Cart</Link>
      </div>
    </section></div>;
  }
  const saved = load.saved;
  const shipping = saved.request.shipping;
  const content = <>
    {step === 'shipping' && <section className={styles.panel}><h2>Shipping Information</h2>
      <div className={styles.reviewCard}><div><h3>Ship to</h3><address>{shipping.recipient}<br />{shipping.line1}{shipping.line2 && <><br />{shipping.line2}</>}<br />{[shipping.city, shipping.state, shipping.postalCode].filter(Boolean).join(', ')}<br />{shipping.country}</address></div></div>
      <p className={styles.subtle}>Shipping for a saved purchase is kept exactly as it was ordered.</p>
      <div className={styles.actions}><Link className={styles.secondaryLink} to="/cart">Return to Cart</Link><Button onClick={() => go('delivery')}>Continue to Delivery</Button></div></section>}
    {step === 'delivery' && <section className={styles.panel}><h2>Delivery Method</h2>
      <div className={styles.reviewCard}><div><h3>{titleCase(saved.request.deliveryMethod)} Delivery</h3><p>Selected when this purchase was placed.</p></div></div>
      <div className={styles.actions}><Button variant="outline" onClick={() => go('shipping')}>Back</Button><Button onClick={() => go('payment')}>Continue to Payment</Button></div></section>}
    {step === 'review' && <section className={styles.panel}><h2>Review Your Order</h2>
      <div className={styles.reviewCard}><div><h3>Shipping Address</h3><address>{shipping.recipient}<br />{shipping.line1}<br />{[shipping.city, shipping.postalCode].filter(Boolean).join(', ')}</address></div>
        <Button variant="ghost" className={styles.editAction} aria-label="View Shipping" onClick={() => go('shipping')}>View</Button></div>
      <div className={styles.reviewCard}><div><h3>{saved.delivery?.label ?? `${titleCase(saved.request.deliveryMethod)} Delivery`}</h3>
          <p>{saved.delivery ? `${saved.delivery.estimate} · ${saved.delivery.price === '0.00' ? 'Free' : money(saved.delivery.price, saved.currency)}` : 'Selected when this purchase was placed.'}</p></div>
        <Button variant="ghost" className={styles.editAction} aria-label="View Delivery Method" onClick={() => go('delivery')}>View</Button></div>
      <div className={styles.reviewCard}><div><h3>Payment Method</h3><p>Credit / Debit Card</p></div>
        <Button variant="ghost" className={styles.editAction} aria-label="Edit Payment Method" onClick={() => go('payment')}>Edit</Button></div>
      <div className={styles.actions}><Button variant="outline" onClick={() => go('payment')}>Back</Button>
        <Button disabled={!ready} onClick={() => void place()}><LockKeyhole size={17} aria-hidden="true" /> Place Order · {money(saved.total, saved.currency)}</Button></div></section>}
  </>;
  const processing = phase === 'processing';
  return <div className={styles.page}>
    {processing ? <div className={styles.processingWrapper}><CheckoutProcessing /></div> : <>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><Link to="/cart">Cart</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">Checkout</span></nav>
      <h1>Checkout</h1>
      <CheckoutStepper current={step} completed={steps.slice(0, steps.indexOf(step))} navigationUnlocked onSelect={go} />
      {message && message !== 'unconfirmed' && <div className={styles.inlineNotice}><p role="alert">{message}</p></div>}
    </>}
    <div className={`${styles.layout} ${styles.retryLayout}`}><div>
      <StripePaymentSession key={saved.clientSecret ?? ''} ref={entry} clientSecret={saved.clientSecret ?? ''} timingAttemptId={attemptId}
        returnPath={`/account/payment-status/${attemptId}?scope=${saved.scope ?? 'CART_CHECKOUT'}`} visible={step === 'payment' && !processing} pending={processing}
        paymentNotice="Test mode. Payment starts only when you place the order on Review."
        onBack={() => go('delivery')} onContinue={() => {
          const current = generation.current;
          void entry.current?.validate().then(error => {
            if (generation.current !== current) return;
            if (error) setMessage(error); else { setMessage(''); setReady(true); go('review'); }
          });
        }}
        // Secure entry shows its own load error and remount action for this same secret.
        onError={() => undefined}>{processing ? null : content}</StripePaymentSession>
    </div>
      {!processing && <SavedPurchaseSummary items={saved.items} total={saved.total} currency={saved.currency} request={saved.request} />}</div>
  </div>;
}
