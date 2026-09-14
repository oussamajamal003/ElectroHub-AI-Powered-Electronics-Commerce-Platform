import { render, screen } from '@testing-library/react';
import { OrderStatus } from './OrderStatus';
import { describe, it, expect } from 'vitest';

describe('OrderStatus Component', () => {
  it('renders processing status correctly', () => {
    render(<OrderStatus status="processing" />);
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Order status: Processing' })).toBeInTheDocument();
  });

  it('renders shipped status correctly', () => {
    render(<OrderStatus status="shipped" />);
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Order status: Shipped' })).toBeInTheDocument();
  });

  it('renders delivered status correctly', () => {
    render(<OrderStatus status="delivered" />);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Order status: Delivered' })).toBeInTheDocument();
  });

  it('renders cancelled status correctly', () => {
    render(<OrderStatus status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Order status: Cancelled' })).toBeInTheDocument();
  });
});
