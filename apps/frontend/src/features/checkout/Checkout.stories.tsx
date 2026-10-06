import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { CheckoutProcessing, CheckoutStepper, ConfirmationContent, DeliveryStep, OrderSummary, PaymentStep, ReviewStep, ShippingStep } from './CheckoutComponents';
import { cart, confirmation, quote, shipping } from './fixtures';
import { emptyShipping } from './state';
import type { DeliveryMethod } from './types';
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
