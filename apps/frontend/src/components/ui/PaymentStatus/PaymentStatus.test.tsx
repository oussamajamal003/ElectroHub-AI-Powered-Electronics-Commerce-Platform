import { render, screen } from '@testing-library/react';
import { PaymentStatus, type PaymentStatusType } from './PaymentStatus';
import { describe, it, expect } from 'vitest';

describe('PaymentStatus Component', () => {
  it.each<[PaymentStatusType, string]>([
    ['pending', 'Pending'], ['paid', 'Paid'], ['failed', 'Failed'], ['refunded', 'Refunded'],
    ['unprocessed', 'Not processed'], ['unknown', 'Status unavailable'],
  ])('renders %s with the exact label and accessible context', (status, label) => {
    const { container } = render(<PaymentStatus status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveTextContent(`Payment status: ${label}`);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('fails safe for an unexpected runtime value', () => {
    render(<PaymentStatus status={'CHARGEBACK' as PaymentStatusType} />);
    expect(screen.getByText('Status unavailable')).toBeInTheDocument();
  });
});
