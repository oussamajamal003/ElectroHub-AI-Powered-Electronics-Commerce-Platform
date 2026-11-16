import { render, screen } from '@testing-library/react';
import { OrderStatus, type OrderStatusType } from './OrderStatus';
import { describe, it, expect } from 'vitest';

describe('OrderStatus Component', () => {
  it.each<[OrderStatusType, string]>([
    ['confirmed', 'Confirmed'], ['preparing', 'Preparing'], ['out_for_delivery', 'Out for Delivery'], ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled'], ['awaiting_capture', 'Finalizing your order'], ['unknown', 'Status unavailable'],
    ['processing', 'Processing'], ['shipped', 'Shipped'],
  ])('renders %s with the exact label and accessible context', (status, label) => {
    const { container } = render(<OrderStatus status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveTextContent(`Order status: ${label}`);
  });
  it('is not a live region, so lists of badges do not flood announcements', () => {
    render(<OrderStatus status="delivered" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('fails safe for an unexpected runtime value', () => {
    render(<OrderStatus status={'RETURNED' as OrderStatusType} />);
    expect(screen.getByText('Status unavailable')).toBeInTheDocument();
  });
});
