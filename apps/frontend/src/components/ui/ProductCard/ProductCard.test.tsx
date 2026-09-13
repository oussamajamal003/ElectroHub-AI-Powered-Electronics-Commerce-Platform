import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProductCard } from './ProductCard';

describe('ProductCard', () => {
  const mockProduct = {
    id: 'p1',
    title: 'Wireless Headphones',
    category: 'Product',
    description: 'Premium noise cancellation',
    price: 129.99,
    rating: 4.8,
    imageUrl: '/test.jpg'
  };

  it('renders all product information correctly', () => {
    render(<ProductCard {...mockProduct} />);
    
    expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Premium noise cancellation')).toBeInTheDocument();
    expect(screen.getByText('$129.99')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByAltText('Wireless Headphones')).toBeInTheDocument();
  });

  it('calls onAddToCart when add button is clicked', () => {
    const handleAdd = vi.fn();
    render(<ProductCard {...mockProduct} onAddToCart={handleAdd} />);
    
    fireEvent.click(screen.getByRole('button', { name: /add wireless headphones to cart/i }));
    expect(handleAdd).toHaveBeenCalledWith('p1');
  });

  it('calls onToggleWishlist when heart button is clicked', () => {
    const handleWishlist = vi.fn();
    render(<ProductCard {...mockProduct} onToggleWishlist={handleWishlist} />);
    
    fireEvent.click(screen.getByRole('button', { name: /add wireless headphones to wishlist/i }));
    expect(handleWishlist).toHaveBeenCalledWith('p1');
  });

  it('displays correct aria-label for wishlisted state', () => {
    render(<ProductCard {...mockProduct} isWishlisted={true} />);
    
    expect(screen.getByRole('button', { name: /remove wireless headphones from wishlist/i })).toBeInTheDocument();
  });
});
