import { render, screen } from '@testing-library/react';
import { PaymentStatus } from './PaymentStatus';
import { describe, it, expect } from 'vitest';

describe('PaymentStatus Component', () => {
  it('renders pending status correctly', () => {
    render(<PaymentStatus status="pending" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Payment status: Pending' })).toBeInTheDocument();
  });

  it('renders paid status correctly', () => {
    render(<PaymentStatus status="paid" />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Payment status: Paid' })).toBeInTheDocument();
  });

  it('renders failed status correctly', () => {
    render(<PaymentStatus status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Payment status: Failed' })).toBeInTheDocument();
  });

  it('renders refunded status correctly', () => {
    render(<PaymentStatus status="refunded" />);
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Payment status: Refunded' })).toBeInTheDocument();
  });
});
