import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { CheckoutProcessing, CheckoutStepper, ConfirmationContent, DeliveryStep, OrderSummary, PaymentStep, ReviewStep, ShippingStep } from './CheckoutComponents';
import { cart, confirmation, quote, shipping } from './fixtures';
import { emptyShipping } from './state';
import type { DeliveryMethod } from './types';
import { PaymentRecovery } from './PaymentRecovery';
import type { PaymentOutcome } from './types';
import styles from './Checkout.module.scss';

function ShippingStory() { const [value, change] = useState({ ...emptyShipping }); return <ShippingStep value={value} onChange={change} onContinue={() => undefined} />; }
function DeliveryStory() { const [selected, change] = useState<DeliveryMethod>('STANDARD'); return <DeliveryStep methods={quote.deliveryMethods} selected={selected} onChange={change} onBack={() => undefined} onContinue={() => undefined} />; }
const meta = { title: 'Customer/Checkout', component: CheckoutStepper, args: { current: 'shipping', completed: [], onSelect: () => undefined }, decorators: [Story => <MemoryRouter><div className={styles.page}><Story /></div></MemoryRouter>] } satisfies Meta<typeof CheckoutStepper>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Stepper: Story = { args: { current: 'delivery', completed: ['shipping'], onSelect: () => undefined } };
export const Shipping: Story = { render: () => <ShippingStory /> };
export const Delivery: Story = { render: () => <DeliveryStory /> };
export const PaymentShell: Story = { render: () => <PaymentStep onBack={() => undefined} onContinue={() => undefined} /> };
export const Summary: Story = { render: () => <OrderSummary cart={cart} totals={quote.deliveryMethods[1]?.totals} deliveryLabel="Express Delivery" /> };
export const Review: Story = { render: () => { const option = quote.deliveryMethods[1]; if (!option) throw new Error('Missing delivery fixture'); return <ReviewStep shipping={shipping} delivery={option} total={option.totals.total} blocked={false} onEdit={() => undefined} onBack={() => undefined} onPlace={() => undefined} />; } };
export const Conflict: Story = { render: () => { const option = quote.deliveryMethods[1]; if (!option) throw new Error('Missing delivery fixture'); return <><div role="alert" className={styles.notice}>Stock or prices changed. Review Cart before placing your order.</div><ReviewStep shipping={shipping} delivery={option} total={option.totals.total} blocked onEdit={() => undefined} onBack={() => undefined} onPlace={() => undefined} /></>; } };
export const Processing: Story = { render: () => <CheckoutProcessing /> };
export const Confirmation: Story = { render: () => <ConfirmationContent order={confirmation} /> };
export const ConfirmationLoading: Story = { render: () => <ElectroHubLoader page /> };
export const ConfirmationError: Story = { render: () => <div role="alert">Confirmation unavailable. Retry loading your saved order.</div> };
export const SecureEntryMount: Story = { render: () => <PaymentStep ready onBack={() => undefined} onContinue={() => undefined}><div role="note">Stripe-hosted Payment Element mounts here in authenticated Checkout. This story does not contact Stripe or collect card data.</div></PaymentStep> };
export const EntryLoading: Story = { render: () => <PaymentStep onBack={() => undefined} onContinue={() => undefined} /> };
export const EntryError: Story = { render: () => <PaymentStep onBack={() => undefined} onContinue={() => undefined}><p role="alert">Secure card entry could not load. Retry payment setup.</p></PaymentStep> };
export const ConfirmationPaid: Story = { render: () => <ConfirmationContent order={{ ...confirmation, paymentState: 'PAID', card: { brand: 'visa', last4: '4242' } }} /> };
export const ConfirmationPending: Story = { render: () => <ConfirmationContent order={{ ...confirmation, status: 'AWAITING_CAPTURE', paymentState: 'PENDING' }} /> };
export const ConfirmationRefunded: Story = { render: () => <ConfirmationContent order={{ ...confirmation, status: 'CANCELLED', paymentState: 'REFUNDED' }} /> };
const recovery = (state: PaymentOutcome['state'], message = '', remainder = false) => <PaymentRecovery message={message} pending={false}
  outcome={{ attemptId: '55555555-5555-4555-8555-555555555555', state, providerStatus: null, failureCode: null,
    total: cart.total, currency: 'USD', orderReference: null, committed: ['CAPTURE_PENDING', 'COMPENSATED', 'REFUND_PENDING', 'REFUNDED'].includes(state),
    cart, confirmation: null, recoveryRemainder: remainder ? [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 2 }] : [], recoveryActive: false }}
  onCheck={() => undefined} onRetry={() => undefined} />;
export const Declined: Story = { render: () => recovery('DECLINED') };
export const ActionRequired: Story = { render: () => recovery('ACTION_REQUIRED', 'Complete your bank’s authentication before payment can continue.') };
export const UnknownOutcome: Story = { render: () => recovery('PROCESSING', 'The outcome is not yet known. Your saved attempt will be checked safely.') };
export const ExpiredAttempt: Story = { render: () => recovery('CANCELED', 'The payment authorization expired. Review your Cart and payment details before trying again.') };
export const CancelPending: Story = { render: () => recovery('CANCEL_PENDING') };
export const CapturePending: Story = { render: () => recovery('CAPTURE_PENDING') };
export const CompensationPending: Story = { render: () => recovery('COMPENSATION_PENDING') };
export const Compensated: Story = { render: () => recovery('COMPENSATED') };
export const RecoveryRemainder: Story = { render: () => recovery('COMPENSATED', '', true) };
export const RefundPending: Story = { render: () => recovery('REFUND_PENDING') };
export const Refunded: Story = { render: () => recovery('REFUNDED') };
export const Incident: Story = { render: () => recovery('INCIDENT', 'Payment requires reconciliation. Do not start another payment; check this attempt again or contact support.') };
