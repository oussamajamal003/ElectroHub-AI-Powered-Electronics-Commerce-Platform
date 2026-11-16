import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock3, ShieldCheck, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Tooltip } from '@/components/ui/Tooltip';
import { ApiError, apiClient } from '@/lib/api';
import { PAYMENTS_UNAVAILABLE_MESSAGE, isPaymentsDisabledError } from './paymentCapability';
import styles from './DismissFailedPurchase.module.scss';

/**
 * What the trash action does for one failed payment. Decided by the server (`removal` on the purchases list) and re-verified by the
 * discard endpoint; the client never infers that a payment is safe to cancel or hide.
 *  REMOVE             already terminal: hide only.
 *  CANCEL_AND_REMOVE  declined, but its payment is still open at the provider: cancel it (verified), then hide.
 *  PENDING            that cancellation was requested and is not confirmed yet.
 *  CONFIRMING         the outcome or its recovery is not confirmed: explain, offer a status check, never hide.
 */
export type FailedPaymentRemoval = 'REMOVE' | 'CANCEL_AND_REMOVE' | 'PENDING' | 'CONFIRMING';

export const REMOVAL_CONFIRM_POLL_MS = 3_000;
export const REMOVAL_CONFIRM_TIMEOUT_MS = 45_000;
export const STATUS_UNCONFIRMED_MESSAGE = 'We need to confirm this payment’s status before it can be removed.';
const CANCEL_PENDING_MESSAGE = 'Cancellation was requested and is still being confirmed with our payment provider. Nothing was charged. This payment will be removed as soon as it’s confirmed.';

interface DiscardResult { attemptId: string; status: 'REMOVED' | 'CANCEL_PENDING'; dismissedAt: string | null }

interface DismissFailedPurchaseProps {
  attemptId: string;
  label: string;
  /** Server-decided action. Absent on an older backend: treated as CONFIRMING (explained, never removed blindly). */
  removal?: FailedPaymentRemoval | null;
  /** Called only after the server confirmed the card is removed. */
  onDismissed: (attemptId: string) => void;
  /** Asks the page to re-read purchases (and nudge recovery) when the customer checks an unconfirmed payment. */
  onCheckStatus?: () => Promise<unknown> | void;
  /** Payment changes are unavailable in this environment: the icon stays, the dialog explains and no write is offered. */
  unavailableReason?: string;
}

/**
 * Remove failed payment: the single trash action on a failed-payment card.
 * One confirmation, one request. The server cancels a still-open declined payment when needed, verifies the cancellation with the
 * provider and only then hides the card; the card is removed here only after the server says so. Nothing is deleted.
 */
export function DismissFailedPurchase({ attemptId, label, removal, onDismissed, onCheckStatus, unavailableReason }: DismissFailedPurchaseProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const mode: FailedPaymentRemoval = removal ?? 'CONFIRMING';
  const cancelling = mode === 'CANCEL_AND_REMOVE';
  const actionable = mode === 'REMOVE' || cancelling;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['payment-purchases'] });

  /** A CANCEL_PENDING answer is not a removal: wait (bounded) for the server's own confirmation before touching the list. */
  const awaitRemoval = async () => {
    const deadline = Date.now() + REMOVAL_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>(resolve => { window.setTimeout(resolve, REMOVAL_CONFIRM_POLL_MS); });
      if (!mounted.current) return 'left' as const;
      try {
        const result = await apiClient<{ data: DiscardResult }>(`/api/checkout/payment-attempts/${encodeURIComponent(attemptId)}/discard`,
          { method: 'POST', data: {}, signal: AbortSignal.timeout(45_000) });
        if (result.data.status === 'REMOVED') return 'removed' as const;
      } catch (failure) {
        // The provider decided otherwise (for example an authorization from another tab): nothing was cancelled or hidden.
        if (failure instanceof ApiError && failure.code === 'PAYMENT_STATUS_UNCONFIRMED') return 'changed' as const;
        // A failed check is not a result; keep waiting within the deadline.
      }
    }
    return 'pending' as const;
  };

  const explain = (failure: unknown) => {
    // A refusal means the cached capability is stale: re-read it so every card reflects the server instead of offering the action again.
    if (isPaymentsDisabledError(failure)) { void queryClient.invalidateQueries({ queryKey: ['payment-capability'] }); return PAYMENTS_UNAVAILABLE_MESSAGE; }
    if (failure instanceof ApiError && failure.code === 'PAYMENT_STATUS_UNCONFIRMED') { void refresh(); return STATUS_UNCONFIRMED_MESSAGE; }
    if (failure instanceof ApiError && failure.status === 409) return 'This payment can’t be removed right now. Refresh and try again.';
    return 'This payment could not be removed. Your purchase is unchanged. Please try again.';
  };

  const remove = async () => {
    // The ref closes the window between two clicks landing before React disables the button.
    if (inFlight.current || unavailableReason) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiClient<{ data: DiscardResult }>(`/api/checkout/payment-attempts/${encodeURIComponent(attemptId)}/discard`,
        { method: 'POST', data: {}, signal: AbortSignal.timeout(45_000) });
      const outcome = result.data.status === 'REMOVED' ? 'removed' : await awaitRemoval();
      if (outcome === 'left') return;
      if (outcome === 'removed') { setOpen(false); onDismissed(attemptId); return; }
      void refresh();
      if (outcome === 'changed') setError(STATUS_UNCONFIRMED_MESSAGE); else setNotice(CANCEL_PENDING_MESSAGE);
    } catch (failure) {
      if (mounted.current) setError(explain(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const check = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'PENDING' && !unavailableReason) {
        // Idempotent: repeats the same server request, which only re-drives the already recorded cancellation.
        const result = await apiClient<{ data: DiscardResult }>(`/api/checkout/payment-attempts/${encodeURIComponent(attemptId)}/discard`,
          { method: 'POST', data: {}, signal: AbortSignal.timeout(45_000) });
        if (result.data.status === 'REMOVED') { setOpen(false); onDismissed(attemptId); return; }
      }
      await onCheckStatus?.();
      await refresh();
      if (mounted.current) setNotice(mode === 'PENDING' ? CANCEL_PENDING_MESSAGE : 'We checked again. This payment isn’t confirmed yet, so it stays in your list for now.');
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ApiError && failure.code === 'PAYMENT_STATUS_UNCONFIRMED' ? STATUS_UNCONFIRMED_MESSAGE
        : isPaymentsDisabledError(failure) ? PAYMENTS_UNAVAILABLE_MESSAGE : 'The status could not be checked right now. Please try again.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const title = cancelling ? 'Cancel and remove this payment?' : mode === 'REMOVE' ? 'Remove this failed payment?'
    : mode === 'PENDING' ? 'Removal in progress' : 'This payment can’t be removed yet';
  const description = cancelling
    ? 'This payment was declined and nothing was charged. We’ll cancel it with our payment provider, then remove it from your list. It can’t be retried afterwards. Your payment history will be preserved.'
    : mode === 'REMOVE' ? 'Remove this failed payment from your list? Your payment history will be preserved.'
      : mode === 'PENDING' ? CANCEL_PENDING_MESSAGE
        : `${STATUS_UNCONFIRMED_MESSAGE} It stays in your list until then, and nothing is hidden or changed.`;
  const hint = cancelling ? 'Cancel and remove failed payment' : mode === 'REMOVE' ? 'Remove failed payment' : 'Removal status';

  return <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
    <Tooltip content={hint} side="left">
      <DialogTrigger asChild>
        <button type="button" className={styles.trigger} data-removal={mode} aria-label={`Remove failed payment for ${label}`} onClick={() => { setError(''); setNotice(''); }}>
          {mode === 'PENDING' ? <Clock3 size={18} aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
        </button>
      </DialogTrigger>
    </Tooltip>
    <DialogContent className={styles.dialog} hideCloseButton data-removal={mode}
      onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <div className={styles.dialogIcon} data-tone={actionable ? 'danger' : 'info'} aria-hidden="true">
        {actionable ? <Trash2 size={22} /> : <ShieldCheck size={22} />}
      </div>
      <DialogTitle className={styles.title}>{title}</DialogTitle>
      <DialogDescription className={styles.description}>{description}</DialogDescription>
      {cancelling && <ul className={styles.steps} aria-label="What happens next">
        <li>We re-check the payment with our payment provider.</li>
        <li>If it’s safe, we cancel it. Nothing is charged.</li>
        <li>The card is removed once the cancellation is confirmed.</li>
      </ul>}
      {unavailableReason && <Alert variant="info">{unavailableReason}</Alert>}
      <div aria-live="polite">{busy && cancelling && <p className={styles.progress}>Cancelling with our payment provider…</p>}
        {notice && <Alert variant="info">{notice}</Alert>}</div>
      {error && <Alert variant="error">{error}</Alert>}
      <div className={styles.actions}>
        {/* "Keep payment" (not "Cancel") beside "Cancel & Remove", so the two never read as the same operation. */}
        <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{cancelling ? 'Keep payment' : actionable ? 'Cancel' : 'Close'}</Button>
        {actionable && !unavailableReason && <Button variant="destructive" onClick={() => void remove()} isLoading={busy} disabled={busy}>{cancelling ? 'Cancel & Remove' : 'Remove'}</Button>}
        {!actionable && !unavailableReason && <Button variant="primary" onClick={() => void check()} isLoading={busy} disabled={busy}>Check payment status</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
