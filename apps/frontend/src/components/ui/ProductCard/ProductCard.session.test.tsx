import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerSessionPending } from '@/features/auth/context/AuthContext';
import { ProductCard } from './ProductCard';

vi.mock('@/features/auth/context/AuthContext', () => ({ useCustomerSessionPending: vi.fn() }));

const props = { id: 'p-1', title: 'Test Tablet', category: 'Tablets', price: 199, imageUrl: '/t.png', stockStatus: 'IN_STOCK' as const, purchasable: true };

describe('ProductCard during the post-reload session check (Task 06.1 R-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('holds Add to Cart and the heart until the session has a verdict, instead of failing or dropping the click', () => {
    vi.mocked(useCustomerSessionPending).mockReturnValue(true);
    const onAddToCart = vi.fn(); const onToggleWishlist = vi.fn();
    render(<ProductCard {...props} onAddToCart={onAddToCart} onToggleWishlist={onToggleWishlist} />);
    const add = screen.getByRole('button', { name: 'Add Test Tablet to cart' });
    const heart = screen.getByRole('button', { name: 'Add Test Tablet to wishlist' });
    expect(add).toBeDisabled(); expect(add).toHaveAttribute('aria-busy', 'true'); expect(heart).toBeDisabled();
    fireEvent.click(add); fireEvent.click(heart);
    expect(onAddToCart).not.toHaveBeenCalled(); expect(onToggleWishlist).not.toHaveBeenCalled();
    expect(screen.queryByText('Could not add item. Please try again.')).not.toBeInTheDocument();
  });

  it('enables both actions once the session is verified', () => {
    vi.mocked(useCustomerSessionPending).mockReturnValue(false);
    const onAddToCart = vi.fn(); const onToggleWishlist = vi.fn();
    render(<ProductCard {...props} onAddToCart={onAddToCart} onToggleWishlist={onToggleWishlist} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Test Tablet to cart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Test Tablet to wishlist' }));
    expect(onAddToCart).toHaveBeenCalledWith('p-1'); expect(onToggleWishlist).toHaveBeenCalledWith('p-1');
  });
});
