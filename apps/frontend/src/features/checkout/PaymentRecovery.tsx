import { Link } from 'react-router-dom';
import { CircleX, PackageX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProductImage } from '@/components/ui/ProductImage';
import type { PaymentOutcome, UnavailableItem } from './types';
import { isResolvedPayment } from './paymentPresentation';
import styles from './Checkout.module.scss';
import { CheckingPayment } from './CheckoutComponents';

const retryableStates = ['DECLINED', 'ACTION_REQUIRED', 'CANCELED', 'COMPENSATED', 'REFUNDED'];

function availabilityText(item: UnavailableItem) {
  if (item.availability === 'UNAVAILABLE' || item.availability === 'NOT_FOUND') return 'No longer available';
  if (item.availableQuantity < 1) return 'Out of stock';
  return item.availableQuantity < item.quantity ? `Only ${item.availableQuantity} available now` : `${item.availableQuantity} available now`;
}

/**
 * PR #51: the item sold out (or was withdrawn) before this purchase's order committed. It is never presented as a card failure, and
 * "not charged" is said only once the provider verified the authorization was cancelled (`authorizationReleased`). Actions are only those
 * the backend permits for this outcome: no Try Again (the server refuses it), no restore while the item cannot be bought.
 */
function SoldOutRecovery({ outcome, checking, onCheck, onLeave }: { outcome: PaymentOutcome; checking: boolean; onCheck(): void; onLeave?(): boolean | void }) {
  const released = outcome.authorizationReleased === true;
  const items = outcome.unavailableItems ?? [];
  const browsable = items.find(item => item.slug && item.availability !== 'UNAVAILABLE' && item.availability !== 'NOT_FOUND');
  return (
    <section className={styles.paymentRecovery} aria-labelledby="payment-recovery-heading" data-outcome="sold-out">
      <div className={styles.soldOutIcon}><PackageX size={40} aria-hidden="true" /></div>
      <h1 id="payment-recovery-heading">{items.length > 1 ? 'Some items sold out' : 'This item sold out'}</h1>
      <p className={styles.failureIntro}>Another customer completed their purchase first, so we couldn’t complete your order.</p>
      {items.length > 0 && <ul className={styles.soldOutItems} aria-label="Items that could not be purchased">
        {items.map(item => <li key={item.productId} className={styles.soldOutItem}>
          <ProductImage src={item.imageUrl ?? undefined} alt="" containerClassName={styles.soldOutImage} />
          <div><strong>{item.name}</strong><span>Quantity requested: {item.quantity}</span><span>{availabilityText(item)}</span></div>
        </li>)}
      </ul>}
      <div className={styles.soldOutNotice} role="status" aria-live="polite">
        {released
          ? <><p><strong>Your card was not charged.</strong> The payment authorization for this order was cancelled.</p>
            <p>If your bank still shows a temporary hold, your bank will release it.</p></>
          : <p>We’re cancelling the payment authorization and checking the result of your payment. Please don’t submit another payment while this check is in progress.</p>}
      </div>
      <div className={styles.recoveryActions}>
        {!released && <Button variant="primary" onClick={onCheck} disabled={checking} isLoading={checking}>Check again</Button>}
        <Link className={released ? styles.primaryLink : styles.secondaryLink} to="/products" onClick={event => { if (onLeave?.() === false) event.preventDefault(); }}>Continue shopping</Link>
        {released && browsable?.slug && <Link className={styles.secondaryLink} to={`/products/${encodeURIComponent(browsable.slug)}`}
          onClick={event => { if (onLeave?.() === false) event.preventDefault(); }}>View product</Link>}
        {released && <Link className={styles.secondaryLink} to="/cart" onClick={event => { if (onLeave?.() === false) event.preventDefault(); }}>Return to Cart</Link>}
      </div>
    </section>
  );
}

export function PaymentRecovery({ outcome, message, pending, onCheck, onRetry, onLeave }: { outcome?: PaymentOutcome | null;
  message: string; pending: boolean; onCheck(): void; onRetry(): void; onLeave?(): boolean | void }) {
  const state = outcome?.state;
  const declined = state === 'DECLINED';
  const isProcessing = pending || !outcome || !isResolvedPayment(outcome) || state === 'PAID';

  const handleAction = (callback?: () => void) => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    callback?.();
  };

  if (outcome?.outcomeReason === 'STOCK_UNAVAILABLE' && !outcome.orderReference) {
    return <SoldOutRecovery outcome={outcome} checking={pending} onCheck={onCheck} onLeave={onLeave} />;
  }

  // Checkout has one checking presentation. Unresolved durable recovery moves
  // to the account status route; it never grows extra actions inside Checkout.
  // Stage 2 (Stage 1 "Processing your order…" belongs to the in-flight Place Order in CheckoutPage).
  // A settled check without a result is shown as unconfirmed with a same-attempt check, never as failure.
  if (isProcessing) {
    const unconfirmed = Boolean(message) || outcome?.classification === 'UNKNOWN';
    return <div className={styles.processingWrapper}>
      <CheckingPayment unconfirmed={unconfirmed} checking={pending} onCheck={onCheck} />
    </div>;
  }

  // 2. CONFIRMED OUTCOMES / TERMINAL FAILURE:
  const refunded = state === 'REFUNDED';
  const failed = Boolean(state && ['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(state));
  const retryable = Boolean(!outcome?.recoveryActive && outcome?.retryAllowed !== false && state && retryableStates.includes(state));

  // Only a provider decline is described as declined; any other failure (including a card confirmation that never reached Stripe) is shown as
  // Payment failed without claiming a decline.
  const providerDecline = declined && outcome?.classification !== 'FAILED';
  const heading = declined ? 'Payment Failed' : refunded ? 'Payment refunded'
    : failed ? 'Payment failed'
      : state === 'ACTION_REQUIRED' ? 'Additional verification required'
        : 'Checking your payment';

  const description = declined ? 'Your purchase has been preserved. You can try again or use another card.'
    : refunded ? 'The payment was refunded and the order was canceled.'
      : state === 'CANCELED' ? 'This payment was canceled. Your purchase details are saved.'
        : state === 'COMPENSATED' ? 'Payment did not complete. Your purchase details are saved.'
          : state === 'ACTION_REQUIRED' ? 'Your bank requires an additional authentication step. Return to secure card entry to continue.'
            : message || 'We’re checking your saved payment attempt. Your cart is saved; please wait for confirmation.';

  return (
    <section className={styles.paymentRecovery} aria-labelledby="payment-recovery-heading">
      {failed ? <div className={styles.failureIcon}><CircleX size={40} aria-hidden="true" /></div> : null}
      <h1 id="payment-recovery-heading">{heading}</h1>
      {providerDecline && <p className={styles.failureIntro}>Your payment was declined. Please check your card details or try a different card.</p>}
      {declined && !providerDecline && <p className={styles.failureIntro}>Your payment didn’t go through, and no money was taken. You can try again with your card.</p>}
      {message && <p role="alert">{message}</p>}
      <div className={failed ? styles.failureNotice : styles.notice} role="status">
        {failed && <CircleX className={styles.failureCardIcon} size={24} aria-hidden="true" />}
        <div className={failed ? styles.failureCopy : undefined}>
          {failed && <strong>Payment not processed</strong>}
          <p>{description}</p>
          {Boolean(outcome?.recoveryRemainder?.length) && <p>Some items could not be restored automatically. Review their availability before adding them again.</p>}
        </div>
        {failed && <span className={styles.failureCardBalance} aria-hidden="true" />}
      </div>
      <div className={styles.recoveryActions}>
        {retryable && <Button variant="primary" onClick={() => handleAction(onRetry)}>Try Again</Button>}
        <Link className={styles.secondaryLink} to="/cart" onClick={event => {
          handleAction();
          if (onLeave?.() === false) event.preventDefault();
        }}>Return to Cart</Link>
      </div>
    </section>
  );
}
