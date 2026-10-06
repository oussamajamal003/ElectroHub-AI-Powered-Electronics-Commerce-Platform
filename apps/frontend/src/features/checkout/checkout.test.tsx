import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedStep, draftKey, newDraft, readDraft, saveDraft, shippingErrors } from './state';
import { customerReturnPath } from '@/features/auth/returnPath';
import { CheckoutStepper, ConfirmationContent, DeliveryStep, OrderSummary, PaymentStep, ReviewStep, ShippingStep } from './CheckoutComponents';
import { cart, confirmation, quote, shipping } from './fixtures';

beforeEach(() => sessionStorage.clear());
describe('Checkout draft and strict navigation', () => {
  it('returns direct future links to the first missing prerequisite', () => {
    const draft = newDraft(); expect(allowedStep('review', draft)).toBe('shipping');
    Object.assign(draft, { shipping, shippingComplete: true }); expect(allowedStep('review', draft)).toBe('delivery');
    draft.deliveryComplete = true; expect(allowedStep('review', draft)).toBe('payment');
    draft.paymentComplete = true; expect(allowedStep('review', draft)).toBe('review');
  });
  it('preserves the immutable submission request separately from edited draft fields', () => {
    const draft = { ...newDraft(), shipping: { ...shipping, city: 'Edited City' }, attempt: {
      key: '44444444-4444-4444-8444-444444444444', status: 'pending' as const,
      request: { shipping, deliveryMethod: 'EXPRESS' as const, paymentMethod: 'CARD' as const, expectedRevision: 'a'.repeat(64) } } };
    expect(saveDraft('customer', draft)).toBe(true);
    expect(readDraft('customer').attempt?.request.shipping.city).toBe('Demo City');
    expect(readDraft('customer').attempt?.status).toBe('unknown');
    expect(readDraft('other').attempt).toBeNull();
  });
  it('rejects foreign/corrupted drafts and unsupported return locations', () => {
    sessionStorage.setItem(draftKey('customer'), JSON.stringify({ version: 1, userId: 'other', draft: newDraft() }));
    expect(readDraft('customer')).toEqual(newDraft());
    expect(customerReturnPath('//evil.example')).toBeUndefined(); expect(customerReturnPath('/checkout?redirect=evil')).toBeUndefined();
    expect(customerReturnPath('/checkout')).toBe('/checkout'); expect(customerReturnPath(confirmation.orderReference)).toBeUndefined();
    expect(customerReturnPath(`/checkout/confirmation/${confirmation.orderReference}`)).toBe(`/checkout/confirmation/${confirmation.orderReference}`);
  });
  it('validates whitespace, field bounds and phone digits', () => {
    expect(shippingErrors(shipping)).toEqual({}); expect(shippingErrors({ ...shipping, recipient: ' ', phone: '123' })).toHaveProperty('recipient');
    expect(shippingErrors({ ...shipping, phone: '123' })).toHaveProperty('phone');
    expect(shippingErrors({ ...shipping, country: 'a'.repeat(101) })).toHaveProperty('country');
  });
});
describe('Production checkout controls', () => {
  it('focuses the first invalid Shipping field and does not advance', () => {
    const next = vi.fn(); render(<MemoryRouter><ShippingStep value={newDraft().shipping} onChange={vi.fn()} onContinue={next} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Delivery' }));
    expect(screen.getByLabelText(/Full Name/)).toHaveFocus(); expect(next).not.toHaveBeenCalled();
  });
  it('renders server delivery prices and whole-row radio choices', () => {
    const change = vi.fn(); render(<DeliveryStep methods={quote.deliveryMethods} selected="STANDARD" onChange={change} onBack={vi.fn()} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Express Delivery/ })); expect(change).toHaveBeenCalledWith('EXPRESS'); expect(screen.getByText('$9.99')).toBeVisible();
  });
  it('collects no card credentials and describes unprocessed payments honestly', () => {
    render(<PaymentStep onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.getByText(/No card details are collected/)).toBeVisible();
  });
  it('blocks Place Order on conflict while keeping editable draft values', () => {
    const delivery = quote.deliveryMethods[1]; if (!delivery) throw new Error('Missing delivery fixture');
    render(<ReviewStep shipping={shipping} delivery={delivery} total={delivery.totals.total} blocked onEdit={vi.fn()} onBack={vi.fn()} onPlace={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Place Order/ })).toBeDisabled(); expect(screen.getByText(/123 Demo Street/)).toBeVisible();
  });
  it('renders persisted snapshots, estimates and Order Total without paid claims', () => {
    render(<MemoryRouter><ConfirmationContent order={confirmation} /></MemoryRouter>);
    expect(screen.getByText(confirmation.orderReference)).toBeVisible(); expect(screen.getByText('Order Total')).toBeVisible();
    expect(screen.getByText(/No payment has been processed/)).toBeVisible(); expect(screen.queryByText('Total Paid')).not.toBeInTheDocument();
  });
  it('renders shipping field placeholders matching Make specifications', () => {
    render(<MemoryRouter><ShippingStep value={newDraft().shipping} onChange={vi.fn()} onContinue={vi.fn()} /></MemoryRouter>);
    expect(screen.getByPlaceholderText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('123 Main St, Apt 4B')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New York')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('10001')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+1 555 000 0000')).toBeInTheDocument();
  });
  it('keeps stepper navigation disabled until Review, then allows keyboard-accessible navigation across steps', async () => {
    const onSelect = vi.fn();
    const view = render(<CheckoutStepper current="delivery" completed={['shipping']} onSelect={onSelect} />);
    const { container } = view;
    const connectors = container.querySelectorAll('ol span[aria-hidden="true"]');
    expect(connectors.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /1\. Shipping, completed/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /2\. Delivery/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /2\. Delivery/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /3\. Payment/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /4\. Review/ })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();

    view.rerender(<CheckoutStepper current="review" completed={['shipping', 'delivery', 'payment']} onSelect={onSelect} />);
    for (const name of [/1\. Shipping/, /2\. Delivery/, /3\. Payment/, /4\. Review/]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    const shippingStep = screen.getByRole('button', { name: /1\. Shipping/ });
    shippingStep.focus(); await userEvent.setup().keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('shipping');

    view.rerender(<CheckoutStepper current="shipping" completed={['delivery', 'payment']} onSelect={onSelect} />);
    for (const name of [/1\. Shipping/, /2\. Delivery/, /3\. Payment/, /4\. Review/]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole('button', { name: /3\. Payment/ }));
    expect(onSelect).toHaveBeenLastCalledWith('payment');
  });
  it('renders Review Edit actions with consistent accessible buttons', () => {
    const delivery = quote.deliveryMethods[1]; if (!delivery) throw new Error('Missing delivery');
    render(<ReviewStep shipping={shipping} delivery={delivery} total={delivery.totals.total} blocked={false} onEdit={vi.fn()} onBack={vi.fn()} onPlace={vi.fn()} />);
    const editButtons = screen.getAllByRole('button', { name: /^Edit/ });
    expect(editButtons).toHaveLength(3);
    editButtons.forEach(btn => expect(btn.className).toContain('editAction'));
  });
  it('renders Order Summary with long Product names and multiple items cleanly', () => {
    const longCart = {
      ...cart,
      items: [
        { ...cart.items[0]!, productId: 'p1', product: { slug: 'apple-watch-9-starlight', name: 'Apple Watch Series 9 41mm GPS — Starlight Aluminum Case with Sport Band', category: 'Watches', price: '329.00', image: { url: '/images/watch.jpg', altText: 'Watch' } }, quantity: 8, lineTotal: '2632.00' },
        { ...cart.items[0]!, productId: 'p2', product: { slug: 'apple-watch-9-silver', name: 'Apple Watch Series 9 41mm GPS — Silver', category: 'Watches', price: '329.00', image: { url: '/images/watch2.jpg', altText: 'Watch' } }, quantity: 1, lineTotal: '329.00' },
      ],
    };
    render(<OrderSummary cart={longCart} totals={quote.deliveryMethods[0]?.totals} deliveryLabel="Standard Delivery" />);
    expect(screen.getByText(/Apple Watch Series 9 41mm GPS — Starlight/)).toBeInTheDocument();
    expect(screen.getByText('Qty: 8')).toBeInTheDocument();
    expect(screen.getByText(/Secure checkout — 256-bit SSL encryption/)).toBeInTheDocument();
  });
});
