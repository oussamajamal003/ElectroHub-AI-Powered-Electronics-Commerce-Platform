import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { PaymentRecovery } from './PaymentRecovery';
import { acknowledgePaymentOutcome, isNotifiableOutcome, synchronizePaymentOutcome, usePresentedPaymentAttempt, type SavedPurchase } from './PaymentPurchases';
import { CHECKOUT_RECOVERY_WINDOW_MS, hasVerifiedPayment, isResolvedPayment } from './paymentPresentation';
import { forgetSubmittedPurchase } from './state';
import type { CheckoutScope, PaymentOutcome } from './types';
import styles from './Checkout.module.scss';

const endpoint = '/api/checkout/payment-attempts';
/** Status reads are database reads (no provider call) but DEV latency reached 8-37 s; past this the page shows a recoverable state. */
export const STATUS_READ_TIMEOUT_MS = 15_000;
function boundedSignal(signal: AbortSignal, ms: number) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms);
  const abort = () => { clearTimeout(timer); controller.abort(); };
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

/**
 * Checkout was re-entered with an empty active Cart after a purchase was submitted from it. That Cart is empty on purpose
 * (the items belong to the submitted purchase), so this shows the purchase itself from its authoritative status. It only
 * reads: it never submits, reconciles, creates a PaymentIntent, or copies the purchase's items into the active Cart.
 * `fallback` is the ordinary empty-Cart view, used only once the server says this purchase is not ours to restore.
 */
export function RestoredPurchase({ attemptId, scope, userId, fallback }: { attemptId: string; scope: CheckoutScope; userId: string; fallback: ReactNode }) {
  const navigate = useNavigate(); const client = useQueryClient();
  const started = useRef(Date.now()); const settled = useRef(''); const [checking, setChecking] = useState(false);
  // The customer is looking at this purchase's own screen, so the global toast must not repeat it.
  usePresentedPaymentAttempt(attemptId);
  // Its own cache key: the saved-purchase retry screen settles on any cached status for the shared key, which would skip its card entry.
  const status = useQuery({ queryKey: ['restored-purchase', userId, attemptId], retry: false, staleTime: 0, refetchOnMount: 'always',
    // Bounded: a slow or unavailable backend ends in the visible "couldn't verify" state with Try again, never an endless loader.
    queryFn: async ({ signal }) => (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attemptId}`, { signal: boundedSignal(signal, STATUS_READ_TIMEOUT_MS) })).data,
    refetchInterval: query => document.visibilityState === 'visible' && (!query.state.data || !isResolvedPayment(query.state.data)) ? 3_000 : false });
  const outcome = status.data?.attemptId === attemptId ? status.data : null;
  useLayoutEffect(() => {
    // Repeat after the loading page is replaced, without changing the saved attempt.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [attemptId, status.isLoading]);
  const notOurs = status.error instanceof ApiError && status.error.status === 404 && !outcome;
  useEffect(() => { if (notOurs) forgetSubmittedPurchase(userId, scope); }, [notOurs, userId, scope]);
  useEffect(() => {
    if (!outcome || !isResolvedPayment(outcome) || outcome.recoveryActive) return;
    const key = `${outcome.attemptId}:${outcome.state}`;
    if (settled.current === key) return;
    settled.current = key;
    synchronizePaymentOutcome(userId, outcome, client);
    if (hasVerifiedPayment(outcome) && outcome.confirmation) {
      const reference = outcome.confirmation.orderReference;
      acknowledgePaymentOutcome(userId, outcome, client);
      client.setQueryData(queryKeys.orders.confirmation(userId, reference), { data: outcome.confirmation });
      void client.invalidateQueries({ queryKey: ['payment-purchases', userId] });
      forgetSubmittedPurchase(userId, scope);
      navigate(`/checkout/confirmation/${reference}`, { replace: true });
    } else if (isNotifiableOutcome(outcome)) acknowledgePaymentOutcome(userId, outcome, client);
  }, [outcome, userId, scope, client, navigate]);
  const unresolved = !outcome || !isResolvedPayment(outcome);
  useEffect(() => {
    if (!outcome || !unresolved) return;
    // Same bounded observation as Checkout: unresolved purchases continue, read-only, from Cart.
    const timer = window.setTimeout(() => navigate(`/cart?purchase=${attemptId}`, { replace: true }),
      Math.max(0, CHECKOUT_RECOVERY_WINDOW_MS - (Date.now() - started.current)));
    return () => window.clearTimeout(timer);
  }, [outcome, unresolved, attemptId, navigate]);

  if (notOurs) return <>{fallback}</>;
  if (status.isLoading) {
    // The saved purchase is shown at once from the purchases list already in this tab; the status read is still authoritative.
    const saved = client.getQueryData<{ data: SavedPurchase[] }>(['payment-purchases', userId])?.data.find(item => item.attemptId === attemptId);
    if (!saved) return <ElectroHubLoader page />;
    return <div className={styles.processingWrapper}><section className={styles.paymentRecovery} aria-labelledby="restored-loading-heading" aria-busy="true">
      <h1 id="restored-loading-heading">Checking your payment</h1>
      <ul aria-label="Saved purchase">{saved.items.map((line, index) => <li key={index}>{line.name} · Qty: {line.quantity}</li>)}</ul>
      <p><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: saved.currency }).format(Number(saved.total))}</strong></p>
      <div className={styles.notice} role="status"><p>We’re getting the latest status of this purchase. Please don’t pay again.</p></div>
    </section></div>;
  }
  // A later failed refresh keeps showing the last status read; only a purchase with no status at all shows the unavailable state.
  if (!outcome) {
    // A failed read is never a payment outcome: nothing is claimed, and the purchase stays where it is.
    return <div className={styles.processingWrapper}><section className={styles.paymentRecovery} aria-labelledby="restored-unavailable-heading">
      <h1 id="restored-unavailable-heading">We couldn’t verify your payment right now</h1>
      <div className={styles.notice} role="status"><p>We couldn’t reach the payment service. Your purchase is unchanged. Please don’t pay again.</p></div>
      <div className={styles.recoveryActions}>
        <Button onClick={() => void status.refetch()} isLoading={status.isFetching} disabled={status.isFetching}>Try again</Button>
        <Link className={styles.secondaryLink} to="/cart">Return to Cart</Link>
      </div></section></div>;
  }
  const check = async () => { setChecking(true); try { await status.refetch(); } finally { setChecking(false); } };
  return <div className={styles.recoveryWrapper}>
    <PaymentRecovery outcome={outcome} message="" pending={checking} onCheck={() => void check()}
      onRetry={() => { forgetSubmittedPurchase(userId, scope); navigate('/checkout?step=payment', { state: { retryPurchase: outcome.attemptId } }); }}
      onLeave={() => { forgetSubmittedPurchase(userId, scope); }} />
  </div>;
}
