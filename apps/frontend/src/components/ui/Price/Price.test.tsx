import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Price } from './Price';

describe('Price Component', () => {
  it('renders current price correctly', () => {
    render(<Price currentPrice={129.99} />);
    expect(screen.getByText('$129.99')).toBeInTheDocument();
  });

  it('renders original price and discount badge when originalPrice is greater than currentPrice', () => {
    render(<Price currentPrice={99.00} originalPrice={129.00} />);
    
    expect(screen.getByText('$99.00')).toBeInTheDocument();
    
    // original price should be accessible
    const originalPriceSpan = screen.getByLabelText('Original price: $129.00');
    expect(originalPriceSpan).toBeInTheDocument();
    
    // discount badge should be -23%
    expect(screen.getByText('-23%')).toBeInTheDocument();
  });

  it('does not render discount badge if originalPrice is equal to currentPrice', () => {
    render(<Price currentPrice={129.00} originalPrice={129.00} />);
    expect(screen.getByText('$129.00')).toBeInTheDocument();
    expect(screen.queryByText(/-\d+%/)).not.toBeInTheDocument();
  });
});
