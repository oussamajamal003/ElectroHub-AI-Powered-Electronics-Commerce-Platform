import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Confirmation, EmailConfirmationSummary } from '@/features/checkout/types';
import { CommerceEmailNotice } from './CommerceEmailNotice';

const updatedAt = '2026-09-04T12:02:00.000Z';
const summary = (state: string): EmailConfirmationSummary => ({ state, updatedAt }) as EmailConfirmationSummary;
const copy = {
  QUEUED: 'Your order and payment confirmations are queued. You can view your order details now.',
  DELAYED: 'Your confirmation emails are taking a little longer. Your order and payment are confirmed.',
  SENT: 'Your order and payment confirmations have been sent. Check your inbox or spam folder.',
  DELIVERED: 'Your order and payment confirmation emails were delivered.',
  PARTIAL: 'Some confirmation emails are still pending or could not be confirmed. Your purchase is confirmed.',
  UNAVAILABLE: 'Your purchase is confirmed. We couldn’t confirm email delivery. Your order details are available here.',
  NONE: 'Your order details are saved here for reference.',
} as const;

function renderNotice(props: Partial<{ paymentState: Confirmation['paymentState']; orderStatus: string; emailConfirmation: EmailConfirmationSummary | null }> = {}) {
  return render(<CommerceEmailNotice paymentState="PAID" orderStatus="CONFIRMED" {...props} />);
}
const liveRegion = () => screen.getByRole('status');

describe('CommerceEmailNotice copy', () => {
  it.each(['QUEUED', 'DELAYED', 'SENT', 'DELIVERED', 'PARTIAL', 'UNAVAILABLE'] as const)('renders the exact %s copy under the email title', state => {
    renderNotice({ emailConfirmation: summary(state) });
    expect(screen.getByRole('heading', { level: 2, name: 'Email confirmations' })).toBeVisible();
    expect(screen.getByText(copy[state])).toBeVisible();
  });

  it('keeps DELIVERED distinct from SENT (no delivery claim for accepted-only mail)', () => {
    const { unmount } = renderNotice({ emailConfirmation: summary('SENT') });
    expect(screen.queryByText(/delivered/i)).toBeNull();
    expect(screen.getByText(copy.SENT)).toBeVisible();
    unmount();
    renderNotice({ emailConfirmation: summary('DELIVERED') });
    expect(screen.queryByText(/have been sent/i)).toBeNull();
  });

  it('treats an unknown future state like UNAVAILABLE', () => {
    renderNotice({ emailConfirmation: summary('BOUNCED_LATER') });
    expect(screen.getByText(copy.UNAVAILABLE)).toBeVisible();
    expect(screen.queryByText(/BOUNCED_LATER/)).toBeNull();
  });

  it('with no projection shows reference copy and never claims queued, sent or delivered mail', () => {
    renderNotice({ emailConfirmation: null });
    expect(screen.getByRole('heading', { level: 2, name: 'Order details' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Email confirmations' })).toBeNull();
    expect(screen.getByText(copy.NONE)).toBeVisible();
    expect(liveRegion().parentElement?.textContent).not.toMatch(/queued|sent|delivered/i);
  });

  it('treats an absent projection (undefined) the same as null', () => {
    renderNotice();
    expect(screen.getByText(copy.NONE)).toBeVisible();
  });

  it('uses text, not colour alone: every state has a visible title and copy, and the icon is decorative', () => {
    const { container } = renderNotice({ emailConfirmation: summary('DELAYED') });
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('CommerceEmailNotice visibility', () => {
  it.each([
    ['PENDING', 'CONFIRMED'],
    ['UNPROCESSED', 'CONFIRMED'],
    ['FAILED', 'CANCELLED'],
    ['REFUNDED', 'CANCELLED'],
    ['FAILED', 'CONFIRMED'],
    ['REFUNDED', 'CONFIRMED'],
  ] as const)('renders nothing for payment %s / order %s', (paymentState, orderStatus) => {
    const { container } = renderNotice({ paymentState, orderStatus, emailConfirmation: summary('SENT') });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a PAID order that is CANCELLED', () => {
    const { container } = renderNotice({ orderStatus: 'CANCELLED', emailConfirmation: summary('QUEUED') });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CommerceEmailNotice accessibility and privacy', () => {
  it('does not announce on first render', () => {
    renderNotice({ emailConfirmation: summary('QUEUED') });
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it('announces a meaningful state change exactly once and not on identical re-renders', () => {
    const { rerender } = renderNotice({ emailConfirmation: summary('QUEUED') });
    rerender(<CommerceEmailNotice paymentState="PAID" orderStatus="CONFIRMED" emailConfirmation={summary('SENT')} />);
    const announced = within(liveRegion()).getAllByText(/./);
    expect(announced).toHaveLength(1);
    expect(liveRegion()).toHaveTextContent(`Email confirmations. ${copy.SENT}`);

    rerender(<CommerceEmailNotice paymentState="PAID" orderStatus="CONFIRMED" emailConfirmation={summary('SENT')} />);
    rerender(<CommerceEmailNotice paymentState="PAID" orderStatus="CONFIRMED" emailConfirmation={summary('SENT')} />);
    expect(within(liveRegion()).getAllByText(/./)).toHaveLength(1);
    expect(liveRegion()).toHaveTextContent(`Email confirmations. ${copy.SENT}`);

    rerender(<CommerceEmailNotice paymentState="PAID" orderStatus="CONFIRMED" emailConfirmation={summary('DELIVERED')} />);
    expect(liveRegion()).toHaveTextContent(`Email confirmations. ${copy.DELIVERED}`);
    expect(within(liveRegion()).getAllByText(/./)).toHaveLength(1);
  });

  it('never renders a recipient email address', () => {
    const { container } = renderNotice({ emailConfirmation: summary('PARTIAL') });
    expect(container.textContent).not.toMatch(/@/);
  });
});
