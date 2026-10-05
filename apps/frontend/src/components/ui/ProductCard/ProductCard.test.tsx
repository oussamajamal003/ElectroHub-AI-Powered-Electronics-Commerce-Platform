import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProductCard } from './ProductCard';
import { ApiError } from '@/lib/api';

describe('ProductCard', () => {
  it.each([['IN_STOCK', 'In Stock', 8], ['LOW_STOCK', 'Low Stock', 2], ['OUT_OF_STOCK', 'Out of Stock', 0]] as const)('renders authoritative %s without blocking navigation or heart', (stockStatus, label, quantity) => {
    const navigate = vi.fn();
    const heart = vi.fn();
    render(<ProductCard id="stock" title="Stock phone" imageUrl="/phone.jpg" price={10} href="/products/phone" onNavigate={navigate}
      stockStatus={stockStatus} availableQuantity={quantity} purchasable={quantity > 0} availability={quantity > 0 ? 'AVAILABLE' : 'UNAVAILABLE'} onAddToCart={vi.fn()} onToggleWishlist={heart} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Stock phone to cart' }).hasAttribute('disabled')).toBe(quantity === 0);
    fireEvent.click(screen.getByRole('button', { name: 'Add Stock phone to wishlist' }));
    expect(heart).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Stock phone' }));
    expect(navigate).toHaveBeenCalledWith('/products/phone');
  });
  it('does not invent Out of Stock for missing or unresolved inventory', () => {
    const { rerender } = render(<ProductCard id="stock" title="Phone" imageUrl="/phone.jpg" price={10} availability="UNAVAILABLE" purchasable={false} onAddToCart={vi.fn()} />);
    expect(screen.getByText('Unavailable', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Out of Stock')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Phone to cart' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Phone to cart' })).toHaveTextContent('Unavailable');
    rerender(<ProductCard id="stock" title="Phone" imageUrl="/phone.jpg" price={10} availability="UNAVAILABLE" stockStatus={null} purchasable={false} onAddToCart={vi.fn()} />);
    expect(screen.getByText('Unavailable', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Out of Stock')).not.toBeInTheDocument();
  });
  const mockProduct = {
    id: 'p1',
    title: 'Wireless Headphones',
    category: 'Product',
    description: 'Premium noise cancellation',
    price: 129.99,
    rating: 4.8,
    reviewCount: 318,
    imageUrl: '/test.jpg'
  };

  it('renders all product information correctly', () => {
    render(<ProductCard {...mockProduct} />);
    
    expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Premium noise cancellation')).toBeInTheDocument();
    expect(screen.getByText('$129.99')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('(318)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rated 4.8 out of 5.' }).querySelectorAll('svg')).toHaveLength(5);
    expect(screen.getByAltText('Wireless Headphones')).toBeInTheDocument();
  });

  it('keeps the approved zero-review presentation without fabricated stars or counts', () => {
    render(<ProductCard {...mockProduct} rating={null} reviewCount={0} />);
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Rated/ })).not.toBeInTheDocument();
    expect(screen.queryByText('(0)')).not.toBeInTheDocument();
  });

  it('calls onAddToCart when add button is clicked', () => {
    const handleAdd = vi.fn();
    render(<ProductCard {...mockProduct} onAddToCart={handleAdd} />);
    
    fireEvent.click(screen.getByRole('button', { name: /add wireless headphones to cart/i }));
    expect(handleAdd).toHaveBeenCalledWith('p1');
  });
  it('shows a sanitized stock conflict when an Add request exceeds current inventory', async () => {
    render(<ProductCard {...mockProduct} onAddToCart={() => Promise.reject(new ApiError(409, 'Only 2 items are currently available.', undefined, 'CART_STOCK_CONFLICT'))} />);
    fireEvent.click(screen.getByRole('button', { name: /add wireless headphones to cart/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 2 items are currently available.');
  });

  it('calls onToggleWishlist when heart button is clicked', () => {
    const handleWishlist = vi.fn();
    render(<ProductCard {...mockProduct} onToggleWishlist={handleWishlist} />);
    
    fireEvent.click(screen.getByRole('button', { name: /add wireless headphones to wishlist/i }));
    expect(handleWishlist).toHaveBeenCalledWith('p1');
  });

  it('displays correct aria-label for wishlisted state', () => {
    render(<ProductCard {...mockProduct} isWishlisted={true} onToggleWishlist={vi.fn()} />);
    
    expect(screen.getByRole('button', { name: /remove wireless headphones from wishlist/i })).toBeInTheDocument();
  });
  it('exposes optimistic Wishlist mutations as busy until the request settles', () => {
    render(<ProductCard {...mockProduct} isWishlisted wishlistPending onToggleWishlist={vi.fn()} />);
    expect(screen.getByRole('button', { name: /remove wireless headphones from wishlist/i })).toHaveAttribute('aria-busy', 'true');
  });

  it('hides actions only when explicitly requested by a display-only consumer', () => {
    render(<ProductCard {...mockProduct} showActions={false} />);
    expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cart|wishlist/i })).not.toBeInTheDocument();
  });

  it('keeps a normal link by default and opts catalog consumers into client navigation', () => {
    const onNavigate = vi.fn();
    const view = render(<ProductCard {...mockProduct} href="/products/wireless-headphones" showActions={false} />);
    const link = screen.getByRole('link', { name: 'Wireless Headphones' });
    expect(link).toHaveAttribute('href', '/products/wireless-headphones');
    view.rerender(<ProductCard {...mockProduct} href="/products/wireless-headphones" onNavigate={onNavigate} showActions={false} />);
    link.addEventListener('click', event => event.preventDefault(), { once: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/products/wireless-headphones');
  });

  it('renders the same Product alternate image before pointer interaction', () => {
    render(<ProductCard {...mockProduct} imageUrl="/primary.jpg" secondaryImageUrl="/alternate.jpg" showActions={false} />);
    expect(screen.getByAltText('Wireless Headphones')).toHaveAttribute('src', '/primary.jpg');
    expect(screen.getByAltText('')).toHaveAttribute('src', '/alternate.jpg');
    expect(screen.getByTestId('product-card')).toHaveAttribute('data-clickable', 'false');
  });

  it('navigates from the card surface without intercepting its image hover or action controls', () => {
    const onNavigate = vi.fn();
    render(<ProductCard {...mockProduct} href="/products/wireless-headphones" onNavigate={onNavigate} onAddToCart={vi.fn()} />);
    fireEvent.click(screen.getByTestId('product-card').querySelector('img')!);
    expect(onNavigate).toHaveBeenCalledWith('/products/wireless-headphones');
    fireEvent.click(screen.getByRole('button', { name: /add wireless headphones to cart/i }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
