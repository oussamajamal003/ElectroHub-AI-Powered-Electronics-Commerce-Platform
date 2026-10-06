import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, CreditCard, LockKeyhole, Truck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import type { CartData } from '@/features/cart/types';
import { shippingErrors, steps } from './state';
import type { CheckoutStep, Confirmation, DeliveryMethod, DeliveryOption, Shipping, Totals } from './types';
import styles from './Checkout.module.scss';

const money = (value: string, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
export function CheckoutStepper({ current, completed, onSelect }: { current: CheckoutStep; completed: CheckoutStep[]; onSelect: (step: CheckoutStep) => void }) {
  const reviewNavigation = completed.includes('payment');
  return <nav aria-label="Checkout steps"><ol className={styles.stepper}>{steps.map((step, index) => {
    const done = completed.includes(step); const active = step === current;
    return <li key={step} className={styles.stepItem}><button type="button" disabled={!reviewNavigation} onClick={() => onSelect(step)} aria-current={active ? 'step' : undefined}
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
    <p className={styles.subtle}><LockKeyhole size={15} aria-hidden="true" /> Secure checkout — 256-bit SSL encryption</p>
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
export function DeliveryStep({ methods, selected, onChange, onBack, onContinue }: { methods: DeliveryOption[]; selected: DeliveryMethod;
  onChange: (method: DeliveryMethod) => void; onBack: () => void; onContinue: () => void }) {
  return <section className={styles.panel}><h2 id="delivery-heading">Delivery Method</h2><div className={styles.deliveryOptions} role="radiogroup" aria-labelledby="delivery-heading">
    {methods.map(method => <label className={`${styles.deliveryOption} ${selected === method.id ? styles.selectedOption : ''}`} key={method.id}>
      <input type="radio" name="delivery" value={method.id} checked={selected === method.id} onChange={() => onChange(method.id)} /><Truck size={22} aria-hidden="true" />
      <span><strong>{method.label}</strong><small>{method.estimate}</small></span><strong>{method.price === '0.00' ? 'Free' : money(method.price)}</strong>
    </label>)}
  </div><div className={styles.actions}><Button variant="outline" onClick={onBack}>Back</Button><Button onClick={onContinue} disabled={!methods.length}>Continue to Payment</Button></div></section>;
}
export function PaymentStep({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  return <section className={styles.panel}><h2>Payment Method</h2><div className={styles.paymentChoice}><CreditCard aria-hidden="true" /><strong>Credit / Debit Card</strong><CheckCircle2 size={20} aria-label="Selected" /></div>
    <div className={styles.providerShell}><LockKeyhole aria-hidden="true" /><h3>Card payment integration is coming next</h3><p>You can create your order now. No card details are collected and no payment is processed in this checkout.</p></div>
    <div className={styles.actions}><Button variant="outline" onClick={onBack}>Back</Button><Button onClick={onContinue}>Review Order</Button></div></section>;
}
export function ReviewStep({ shipping, delivery, total, blocked, onEdit, onBack, onPlace }: { shipping: Shipping; delivery: DeliveryOption; total: string;
  blocked: boolean; onEdit: (step: CheckoutStep) => void; onBack: () => void; onPlace: () => void }) {
  return <section className={styles.panel}><h2>Review Your Order</h2>
    <div className={styles.reviewCard}><div><h3>Shipping Address</h3><address>{shipping.recipient}<br />{shipping.line1}{shipping.line2 && <><br />{shipping.line2}</>}<br />{[shipping.city, shipping.state, shipping.postalCode].filter(Boolean).join(', ')}<br />{shipping.country}<br />{shipping.phone}</address></div><Button variant="ghost" className={styles.editAction} aria-label="Edit Shipping Address" onClick={() => onEdit('shipping')}>Edit</Button></div>
    <div className={styles.reviewCard}><div><h3>{delivery.label}</h3><p>{delivery.estimate}</p></div><Button variant="ghost" className={styles.editAction} aria-label="Edit Delivery Method" onClick={() => onEdit('delivery')}>Edit</Button></div>
    <div className={styles.reviewCard}><div><h3>Payment Method</h3><p>Credit / Debit Card</p><small>No payment processed yet.</small></div><Button variant="ghost" className={styles.editAction} aria-label="Edit Payment Method" onClick={() => onEdit('payment')}>Edit</Button></div>
    <div className={styles.actions}><Button variant="outline" onClick={onBack}>Back</Button><Button disabled={blocked} onClick={onPlace}><LockKeyhole size={17} aria-hidden="true" /> Place Order · {money(total)}</Button></div>
  </section>;
}
export function CheckoutProcessing() {
  return <section className={styles.processing} aria-labelledby="processing-heading"><ElectroHubLoader size="lg" /><h1 id="processing-heading">Processing your order…</h1><p>Please keep this page open while we confirm your order.</p></section>;
}
export function ConfirmationContent({ order }: { order: Confirmation }) {
  const delivery = { STANDARD: 'Standard Delivery', EXPRESS: 'Express Delivery', OVERNIGHT: 'Overnight Delivery' }[order.deliveryMethod];
  const date = (value: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  return <div className={`${styles.page} ${styles.confirmation}`}><div className={styles.successIcon}><CheckCircle2 size={46} aria-hidden="true" /></div><h1>Order Confirmed!</h1>
    <p className={styles.intro}>We’ve received your order. No payment has been processed yet.</p><section className={styles.confirmationCard} aria-label="Order confirmation">
      <div className={styles.orderHeading}><div><span className={styles.eyebrow}>Order Reference</span><h2>{order.orderReference}</h2></div><span className={styles.orderStatus}>Order received</span></div>
      <div className={`${styles.orderDate} ${styles.orderDateSection}`}><span className={styles.eyebrow}>Order Date</span><p>{date(order.createdAt)}</p></div>
      {order.items.map(item => <div className={styles.summaryItem} key={item.productId}>{item.imageUrl ? <img src={item.imageUrl} alt="" width={64} height={64} /> : <div className={styles.imagePlaceholder} aria-hidden="true" />}<div><strong>{item.productName}</strong><span>Qty: {item.quantity}</span><span>{money(item.unitPrice)} each</span></div><strong>{money(item.lineTotal)}</strong></div>)}
      <div className={styles.totalRow}><span>Subtotal</span><span>{money(order.subtotal)}</span></div><div className={styles.totalRow}><span>Shipping ({delivery})</span><span>{order.shippingCost === '0.00' ? 'Free' : money(order.shippingCost)}</span></div>
      <div className={`${styles.totalRow} ${styles.grandTotal}`}><strong>Order Total</strong><strong>{money(order.total)}</strong></div>
      <div className={styles.orderDate}><span className={styles.eyebrow}>Estimated Delivery</span><p><strong>{date(order.estimatedDeliveryStart)}{order.estimatedDeliveryEnd !== order.estimatedDeliveryStart ? ` – ${date(order.estimatedDeliveryEnd)}` : ''}</strong></p><address>To: {order.shipping.recipient}<br />{[order.shipping.line1, order.shipping.line2, order.shipping.city, order.shipping.state, order.shipping.postalCode, order.shipping.country].filter(Boolean).join(', ')}</address><p className={styles.subtle}>Business-day estimate; holidays and delivery cutoffs may affect arrival.</p></div>
    </section><Link className={styles.primaryLink} to="/products">Continue Shopping</Link></div>;
}
