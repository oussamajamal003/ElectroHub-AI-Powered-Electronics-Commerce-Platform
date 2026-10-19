import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, Clock3, CreditCard, LockKeyhole, RotateCcw, ShieldCheck, Truck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import type { CartData } from '@/features/cart/types';
import { CommerceEmailNotice } from '@/features/orders/CommerceEmailNotice';
import { TransientEmailNotice } from '@/features/orders/TransientEmailNotice';
import { shippingErrors, steps } from './state';
import type { CheckoutStep, Confirmation, DeliveryMethod, DeliveryOption, OrderRequest, Shipping, Totals } from './types';
import styles from './Checkout.module.scss';

const money = (value: string, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
export function CheckoutStepper({ current, completed, onSelect, navigationUnlocked, disabled = false }: { current: CheckoutStep; completed: CheckoutStep[]; onSelect: (step: CheckoutStep) => void; navigationUnlocked?: boolean; disabled?: boolean }) {
  const reviewNavigation = navigationUnlocked ?? completed.includes('payment');
  return <nav aria-label="Checkout steps"><ol className={styles.stepper}>{steps.map((step, index) => {
    // Saved prerequisites remain valid when returning to Shipping, but future
    // steps must not look selected/completed ahead of the current position.
    const done = completed.includes(step) && index < steps.indexOf(current); const active = step === current;
    return <li key={step} className={styles.stepItem}><button type="button" disabled={disabled || !reviewNavigation} onClick={() => onSelect(step)} aria-current={active ? 'step' : undefined}
      className={`${styles.stepButton} ${active ? styles.activeStep : ''} ${done ? styles.doneStep : ''}`} aria-label={`${index + 1}. ${step === 'payment' ? 'Payment' : step[0]?.toUpperCase() + step.slice(1)}${done ? ', completed' : ''}`}>
      <span className={styles.stepNumber}>{done && !active ? <Check size={16} aria-hidden="true" /> : index + 1}</span><span className={styles.stepLabel}>{step === 'payment' ? 'Payment' : step[0]?.toUpperCase() + step.slice(1)}</span>
    </button>{index < steps.length - 1 && <span className={`${styles.stepConnector} ${done ? styles.connectorDone : ''}`} aria-hidden="true" />}</li>;
  })}</ol></nav>;
}
export function OrderSummary({ cart, totals, deliveryLabel }: { cart: CartData; totals?: Totals; deliveryLabel: string }) {
  return <aside className={styles.summary} aria-labelledby="checkout-summary-heading"><h2 id="checkout-summary-heading">Order Summary</h2>
    <div className={styles.summaryItems}>{cart.items.map(item => <div className={styles.summaryItem} key={item.productId}>
      {item.product?.image?.url ? <img src={item.product.image.url} alt="" width={64} height={64} /> : <div className={styles.imagePlaceholder} aria-hidden="true" />}
      <div><strong>{item.product?.name ?? 'Product unavailable'}</strong><span>Qty: {item.quantity}</span><span>{item.product ? `${money(item.product.price)} each` : 'Unavailable'}</span></div>
      <strong>{item.lineTotal ? money(item.lineTotal) : '—'}</strong>
    </div>)}</div>
    <div className={styles.totalRow}><span>Subtotal</span><span>{money(cart.subtotal)}</span></div>
    <div className={styles.totalRow}><span>{deliveryLabel}</span><span className={totals?.shipping === '0.00' ? styles.free : undefined}>{totals ? totals.shipping === '0.00' ? 'Free' : money(totals.shipping) : 'Loading…'}</span></div>
    <div className={`${styles.totalRow} ${styles.grandTotal}`} aria-live="polite"><strong>Total</strong><strong>{totals ? money(totals.total) : 'Calculating…'}</strong></div>
    <p className={styles.subtle}><LockKeyhole size={15} aria-hidden="true" /> Card details are handled securely by Stripe.</p>
  </aside>;
}
/** The saved purchase being paid again: its server snapshot, never the active Cart. */
export function SavedPurchaseSummary({ items, total, currency, request }: { items: { name: string; quantity: number; imageUrl?: string | null }[]; total: string; currency: string; request: OrderRequest }) {
  return <aside className={`${styles.summary} ${styles.retrySummary}`} aria-labelledby="checkout-summary-heading">
    <p className={styles.retryLabel}><RotateCcw size={15} aria-hidden="true" />Retrying payment for this purchase</p>
    <h2 id="checkout-summary-heading">Order Summary</h2>
    <div className={styles.summaryItems}>{items.map((item, index) => <div className={styles.summaryItem} key={index}>
      {item.imageUrl ? <img src={item.imageUrl} alt="" width={64} height={64} /> : <div className={styles.imagePlaceholder} aria-hidden="true" />}
      <div><strong>{item.name}</strong><span>Qty: {item.quantity}</span></div>
    </div>)}</div>
    <div className={styles.totalRow}><span>Ship to</span><span>{request.shipping.recipient}, {request.shipping.city}</span></div>
    <div className={styles.totalRow}><span>Delivery</span><span>{request.deliveryMethod.charAt(0) + request.deliveryMethod.slice(1).toLowerCase()}</span></div>
    <div className={`${styles.totalRow} ${styles.grandTotal}`}><strong>Verified total</strong><strong>{money(total, currency)}</strong></div>
    <p className={styles.subtle}><LockKeyhole size={15} aria-hidden="true" /> Availability and price were re-checked for this saved purchase. Card details are handled securely by Stripe.</p>
  </aside>;
}
const fields: { key: keyof Shipping; label: string; placeholder: string; required?: boolean; autoComplete: string }[] = [
  { key: 'recipient', label: 'Full Name', placeholder: 'Jane Smith', required: true, autoComplete: 'shipping name' },
  { key: 'line1', label: 'Street Address', placeholder: '123 Main St, Apt 4B', required: true, autoComplete: 'shipping address-line1' },
  { key: 'line2', label: 'Apartment / Address Line 2 (optional)', placeholder: 'Apt 4B, Suite 200 (optional)', autoComplete: 'shipping address-line2' },
  { key: 'city', label: 'City', placeholder: 'New York', required: true, autoComplete: 'shipping address-level2' },
  { key: 'postalCode', label: 'Postcode / ZIP', placeholder: '10001', required: true, autoComplete: 'shipping postal-code' },
  { key: 'state', label: 'State / Province (optional)', placeholder: 'NY', autoComplete: 'shipping address-level1' },
  { key: 'country', label: 'Country', placeholder: 'United States', required: true, autoComplete: 'shipping country-name' },
  { key: 'phone', label: 'Phone Number', placeholder: '+1 555 000 0000', required: true, autoComplete: 'shipping tel' },
];
export function ShippingStep({ value, onChange, onContinue }: { value: Shipping; onChange: (value: Shipping) => void; onContinue: () => void }) {
  const [errors, setErrors] = useState<Partial<Record<keyof Shipping, string>>>({});
  const refs = useRef<Partial<Record<keyof Shipping, HTMLInputElement | null>>>({});
  return <form className={styles.panel} noValidate onSubmit={event => {
    event.preventDefault(); const errors = shippingErrors(value); setErrors(errors);
    const first = fields.find(field => errors[field.key]);
    if (first) refs.current[first.key]?.focus(); else onContinue();
  }}><h2>Shipping Information</h2><div className={styles.formGrid}>{fields.map(field => <div key={field.key} className={['city', 'postalCode', 'country', 'state'].includes(field.key) ? undefined : styles.fullWidth}>
    <Input label={field.label} id={`shipping-${field.key}`} ref={node => { refs.current[field.key] = node; }} required={field.required}
      placeholder={field.placeholder} autoComplete={field.autoComplete} type={field.key === 'phone' ? 'tel' : 'text'} maxLength={field.key === 'line1' || field.key === 'line2' ? 255 : field.key === 'recipient' ? 200 : field.key === 'phone' ? 32 : field.key === 'postalCode' ? 20 : 100}
      fullWidth value={value[field.key]} error={errors[field.key]} onChange={event => { onChange({ ...value, [field.key]: event.target.value }); setErrors(previous => ({ ...previous, [field.key]: undefined })); }} />
  </div>)}</div><div className={styles.actions}><Link className={styles.secondaryLink} to="/cart">Back to Cart</Link><Button type="submit">Continue to Delivery</Button></div></form>;
}
const EXPECTED_DELIVERY_METHODS = [
  { id: 'STANDARD', titleWidth: '9.5rem', estimateWidth: '13rem', priceWidth: '2.75rem' },
  { id: 'EXPRESS', titleWidth: '9rem', estimateWidth: '12rem', priceWidth: '3.5rem' },
  { id: 'OVERNIGHT', titleWidth: '10rem', estimateWidth: '11.5rem', priceWidth: '3.75rem' },
] as const;

export function DeliverySkeleton() {
  return (
    <div className={styles.deliverySkeleton} role="status" aria-label="Loading delivery options">
      {EXPECTED_DELIVERY_METHODS.map(method => (
        <div key={method.id} className={styles.deliveryOptionSkeleton} aria-hidden="true">
          <div className={styles.skeletonRadio} />
          <div className={styles.skeletonTruck} />
          <div className={styles.skeletonDetails}>
            <div className={styles.skeletonTitle} style={{ width: method.titleWidth }} />
            <div className={styles.skeletonEstimate} style={{ width: method.estimateWidth }} />
          </div>
          <div className={styles.skeletonPrice} style={{ width: method.priceWidth }} />
        </div>
      ))}
    </div>
  );
}

export function DeliveryStep({ methods, selected, onChange, onBack, onContinue, loading = false }: { methods: DeliveryOption[]; selected: DeliveryMethod;
  onChange: (method: DeliveryMethod) => void; onBack: () => void; onContinue: () => void; loading?: boolean }) {
  return <section className={styles.panel}><h2 id="delivery-heading">Delivery Method</h2>
    {loading ? <DeliverySkeleton /> : methods.length === 0 ? <p className={styles.subtle} role="status">No delivery options available.</p> : (
      <div className={styles.deliveryOptions} role="radiogroup" aria-labelledby="delivery-heading">
        {methods.map(method => <label className={`${styles.deliveryOption} ${selected === method.id ? styles.selectedOption : ''}`} key={method.id}>
          <input type="radio" name="delivery" value={method.id} checked={selected === method.id} onChange={() => onChange(method.id)} /><Truck size={22} aria-hidden="true" />
          <span><strong>{method.label}</strong><small>{method.estimate}</small></span><strong>{method.price === '0.00' ? 'Free' : money(method.price)}</strong>
        </label>)}
      </div>
    )}
    <div className={styles.actions}><Button variant="outline" onClick={onBack} disabled={loading}>Back</Button><Button onClick={onContinue} disabled={loading || !methods.length}>Continue to Payment</Button></div></section>;
}
/** Secure payment setup still in flight: keep the skeleton, and after a while say so truthfully.
 * No retry here: a second request while setup is running would only duplicate server work. */
export function PaymentSetupPending({ slowAfterMs = 25_000 }: { slowAfterMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setSlow(true), slowAfterMs); return () => window.clearTimeout(timer); }, [slowAfterMs]);
  return <><PaymentSkeleton />
    {slow && <div role="status" className={styles.inlineNotice}><p>Preparing secure payment is taking longer than usual. The card form will appear here as soon as it is ready.</p></div>}</>;
}
export function PaymentSkeleton() {
  return <div className={styles.paymentSkeleton} role="status" aria-label="Loading secure payment form">
    <div className={styles.skeletonTab} aria-hidden="true" />
    <div className={styles.skeletonFields} aria-hidden="true">
      <div className={styles.skeletonGroup}>
        <div className={styles.skeletonLabel} />
        <div className={styles.skeletonInput} />
      </div>
      <div className={styles.skeletonRow}>
        <div className={styles.skeletonGroup}>
          <div className={styles.skeletonLabelHalf} />
          <div className={styles.skeletonInput} />
        </div>
        <div className={styles.skeletonGroup}>
          <div className={styles.skeletonLabelHalf} />
          <div className={styles.skeletonInput} />
        </div>
      </div>
      <div className={styles.skeletonGroup}>
        <div className={styles.skeletonLabel} />
        <div className={styles.skeletonInput} />
      </div>
    </div>
  </div>;
}
export function PaymentStep({ onBack, onContinue, children, ready = false, canContinue = ready, pending = false, actionLabel = 'Review Order', paymentNotice = 'Test mode. Payment starts only when you place the order on Review.' }: { actionLabel?: string; paymentNotice?: string; onBack: () => void; onContinue: () => void; children?: ReactNode; ready?: boolean; canContinue?: boolean; pending?: boolean }) {
  return <section className={styles.panel}><h2>Payment Method</h2><div className={styles.paymentChoice}><CreditCard aria-hidden="true" /><strong>Credit / Debit Card</strong><CheckCircle2 size={20} aria-label="Selected" /></div>
    <div className={styles.providerShell}>{children ?? <PaymentSkeleton />}</div>
    <p className={styles.subtle}>{paymentNotice}</p>
    <div className={styles.actions}><Button variant="outline" onClick={onBack} disabled={pending}>Back</Button><Button onClick={onContinue} disabled={!ready || !canContinue || pending}>{actionLabel}</Button></div></section>;
}
export function ReviewStep({ shipping, delivery, total, blocked, onEdit, onBack, onPlace }: { shipping: Shipping; delivery: DeliveryOption; total: string;
  blocked: boolean; onEdit: (step: CheckoutStep) => void; onBack: () => void; onPlace: () => void }) {
  return <section className={styles.panel}><h2>Review Your Order</h2>
    <div className={styles.reviewCard}><div><h3>Shipping Address</h3><address>{shipping.recipient}<br />{shipping.line1}{shipping.line2 && <><br />{shipping.line2}</>}<br />{[shipping.city, shipping.state, shipping.postalCode].filter(Boolean).join(', ')}<br />{shipping.country}<br />{shipping.phone}</address></div><Button variant="ghost" className={styles.editAction} aria-label="Edit Shipping Address" onClick={() => onEdit('shipping')}>Edit</Button></div>
    <div className={styles.reviewCard}><div><h3>{delivery.label}</h3><p>{delivery.estimate}</p></div><Button variant="ghost" className={styles.editAction} aria-label="Edit Delivery Method" onClick={() => onEdit('delivery')}>Edit</Button></div>
    <div className={styles.reviewCard}><div><h3>Payment Method</h3><p>Credit / Debit Card</p></div><Button variant="ghost" className={styles.editAction} aria-label="Edit Payment Method" onClick={() => onEdit('payment')}>Edit</Button></div>
    <div className={styles.actions}><Button variant="outline" onClick={onBack}>Back</Button><Button disabled={blocked} onClick={onPlace}><LockKeyhole size={17} aria-hidden="true" /> Place Order · {money(total)}</Button></div>
  </section>;
}
/** Stage 2: the submitted payment is durably saved and the outcome is being verified.
 * `unconfirmed` = a check settled without a result (network/5xx/unknown provider state): never a failure claim. */
export function CheckingPayment({ unconfirmed = false, checking = false, note, onCheck }: { unconfirmed?: boolean; checking?: boolean; note?: string; onCheck?: () => void }) {
  return <section className={styles.checking} aria-labelledby="checking-heading" data-state={unconfirmed ? 'unconfirmed' : 'checking'}>
    <div className={styles.checkingVisual} aria-hidden="true">
      {!unconfirmed && <><span className={styles.checkingPulse} /><span className={styles.checkingArc} /></>}
      <span className={styles.checkingBadge}>{unconfirmed ? <Clock3 size={30} /> : <Zap size={30} fill="currentColor" />}</span>
    </div>
    <h1 id="checking-heading">{unconfirmed ? 'We couldn’t confirm your payment yet' : 'Checking your payment'}</h1>
    <div role="status" aria-live="polite" className={styles.checkingCopy}>
      {unconfirmed
        ? <p>Your payment attempt is saved. This isn’t a payment failure — we couldn’t reach the payment service to confirm it. Please don’t pay again.</p>
        : <p>Your payment was submitted. We’re confirming the result with our payment provider.</p>}
      {note && <p className={styles.checkingNote}>{note}</p>}
    </div>
    <p className={styles.checkingHint}><ShieldCheck size={16} aria-hidden="true" />You can keep shopping. We’ll notify you as soon as the result is confirmed.</p>
    <div className={styles.checkingActions}>
      {unconfirmed && onCheck && <Button onClick={onCheck} disabled={checking} isLoading={checking}>Check again</Button>}
      <Link className={styles.checkingLink} to="/products">Continue shopping</Link>
    </div>
  </section>;
}
export function CheckoutProcessing() {
  return <section className={styles.processing} aria-labelledby="processing-heading"><ElectroHubLoader size="lg" /><h1 id="processing-heading">Processing your order…</h1><p aria-live="polite">You can continue shopping while we securely verify your payment.</p></section>;
}
/** `ownerId` enables the notice's 60-second lifetime; without it (stories, static previews) the notice is shown as given. */
export function ConfirmationContent({ order, ownerId }: { order: Confirmation; ownerId?: string }) {
  const paid = order.paymentState === 'PAID';
  const delivery = { STANDARD: 'Standard Delivery', EXPRESS: 'Express Delivery', OVERNIGHT: 'Overnight Delivery' }[order.deliveryMethod];
  const date = (value: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  return <div className={`${styles.page} ${styles.confirmation}`}>{paid && <div className={styles.successIcon}><CheckCircle2 size={46} aria-hidden="true" /></div>}<h1>{paid ? 'Order Confirmed!' : order.paymentState === 'UNPROCESSED' ? 'Order received' : order.paymentState === 'PENDING' ? 'Payment is being confirmed' : 'Order payment update'}</h1>
    <p className={styles.intro}>{paid ? 'Thank you for your purchase. We’ve received your order and your payment is confirmed.' : order.paymentState === 'UNPROCESSED' ? 'We’ve received your order. No payment has been processed yet.' : order.paymentState === 'PENDING' ? 'Your order was received. Payment is still being reconciled; please do not pay again.' : order.paymentState === 'REFUNDED' ? 'The payment was refunded and this order was canceled.' : 'Payment did not complete and this order was canceled.'}</p><section className={styles.confirmationCard} aria-label="Order confirmation">
      <div className={styles.orderHeading}>
        <div className={styles.orderRefCol}><span className={styles.eyebrow}>Order Reference</span><h2>{order.orderReference}</h2></div>
        <div className={styles.orderBadges}>
          <Badge variant={order.status === 'CANCELLED' ? 'error' : 'info'} size="md">
            {order.status === 'CANCELLED' ? 'Order canceled' : 'Order Received'}
          </Badge>
          {paid ? (
            <Badge variant="success" size="md">
              Paid
            </Badge>
          ) : order.paymentState === 'REFUNDED' ? (
            <Badge variant="neutral" size="md">
              Refunded
            </Badge>
          ) : order.paymentState === 'FAILED' ? (
            <Badge variant="error" size="md">
              Payment failed
            </Badge>
          ) : null}
        </div>
      </div>
      <div className={`${styles.orderDate} ${styles.orderDateSection}`}><span className={styles.eyebrow}>Order Date</span><p>{date(order.createdAt)}</p></div>
      {order.items.map(item => <div className={styles.summaryItem} key={item.productId}>{item.imageUrl ? <img src={item.imageUrl} alt="" width={64} height={64} /> : <div className={styles.imagePlaceholder} aria-hidden="true" />}<div><strong>{item.productName}</strong><span>Qty: {item.quantity}</span><span>{money(item.unitPrice)} each</span></div><strong>{money(item.lineTotal)}</strong></div>)}
      <div className={styles.totalRow}><span>Subtotal</span><span>{money(order.subtotal)}</span></div><div className={styles.totalRow}><span>Shipping ({delivery})</span><span>{order.shippingCost === '0.00' ? 'Free' : money(order.shippingCost)}</span></div>
      <div className={`${styles.totalRow} ${styles.grandTotal}`}><strong>{paid ? 'Total Paid' : 'Order Total'}</strong><strong>{money(order.total)}</strong></div>
      {order.card && <p className={styles.subtle}>{order.card.brand} ending {order.card.last4}</p>}
      <div className={styles.orderDate}><span className={styles.eyebrow}>Estimated Delivery</span><p><strong>{date(order.estimatedDeliveryStart)}{order.estimatedDeliveryEnd !== order.estimatedDeliveryStart ? ` – ${date(order.estimatedDeliveryEnd)}` : ''}</strong></p><address>To: {order.shipping.recipient}<br />{[order.shipping.line1, order.shipping.line2, order.shipping.city, order.shipping.state, order.shipping.postalCode, order.shipping.country].filter(Boolean).join(', ')}</address><p className={styles.subtle}>Business-day estimate; holidays and delivery cutoffs may affect arrival.</p></div>
    </section>
    {ownerId ? <TransientEmailNotice ownerId={ownerId} order={order} />
      : <CommerceEmailNotice paymentState={order.paymentState} orderStatus={order.status} emailConfirmation={order.emailConfirmation} />}
    {/* Outside the bordered card, sharing its width: the durable Order Details page, then continued shopping. Navigation only. */}
    <div className={styles.confirmationActions}>
      {order.orderReference && <Link className={styles.primaryLink} to={`/orders/${order.orderReference}`}>View Order Details</Link>}
      <Link className={styles.secondaryLink} to="/products">Continue Shopping</Link>
    </div></div>;
}
