import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { ApiError, apiClient } from '@/lib/api';
import { PAYMENTS_UNAVAILABLE_MESSAGE, isPaymentsDisabledError } from './paymentCapability';
import styles from './DismissFailedPurchase.module.scss';

interface DismissFailedPurchaseProps {
  attemptId: string;
  label: string;
  onDismissed: (attemptId: string) => void;
  /** Payment changes are unavailable in this environment: the icon stays, the dialog explains and Remove is not offered. */
  unavailableReason?: string;
}

/**
 * Hides one failed purchase from the customer's list through the owner-scoped backend dismissal.
 * Nothing is deleted: the payment history stays. The card is removed only after the server confirms.
 */
export function DismissFailedPurchase({ attemptId, label, onDismissed, unavailableReason }: DismissFailedPurchaseProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const remove = async () => {
    if (busy || unavailableReason) return;
    setBusy(true);
    setError('');
    try {
      await apiClient<{ data: { attemptId: string; dismissedAt: string } }>(`/api/checkout/payment-attempts/${encodeURIComponent(attemptId)}/dismiss`, { method: 'POST', data: {} });
      setOpen(false);
      onDismissed(attemptId);
    } catch (failure) {
      // A refusal means the cached capability is stale: re-read it so every card reflects the server instead of offering Remove again.
      if (isPaymentsDisabledError(failure)) void queryClient.invalidateQueries({ queryKey: ['payment-capability'] });
      setError(isPaymentsDisabledError(failure) ? PAYMENTS_UNAVAILABLE_MESSAGE : failure instanceof ApiError && failure.status === 409
        ? 'This payment can’t be removed right now. Refresh and try again.'
        : 'This payment could not be removed. Your purchase is unchanged. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogTrigger asChild>
        <button type="button" className={styles.trigger} aria-label={`Remove failed payment for ${label}`} onClick={() => setError('')}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={styles.dialog} hideCloseButton
        onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <DialogTitle className={styles.title}>Remove this failed payment?</DialogTitle>
        <DialogDescription className={styles.description}>Remove this failed payment from your list? Your payment history will be preserved.</DialogDescription>
        {unavailableReason && <Alert variant="info">{unavailableReason}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        <div className={styles.actions}>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          {!unavailableReason && <Button variant="destructive" onClick={() => void remove()} isLoading={busy} disabled={busy}>Remove</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
