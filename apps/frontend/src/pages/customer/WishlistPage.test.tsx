import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { WishlistPageContent } from './WishlistPage';
import { wishlistFixture, wishlistProduct } from '@/features/wishlist/fixtures';
import { getWishlistSkeletonCount } from '@/features/wishlist/skeletonCount';
import type { WishlistContextValue } from '@/features/wishlist/context';
const renderPage = (wishlist: WishlistContextValue) => render(<MemoryRouter><WishlistPageContent wishlist={wishlist} onNavigate={() => undefined} onAddToCart={async () => undefined} /></MemoryRouter>);
it('renders structural loading instead of false empty', () => {
  renderPage(wishlistFixture({ data: undefined, isLoading: true, expectedCount: 2 }));
  expect(screen.getByRole('status', { name: 'Loading wishlist' })).toBeInTheDocument();
  expect(screen.getAllByTestId('product-skeleton')).toHaveLength(2);
  expect(screen.queryByText('Your wishlist is empty')).not.toBeInTheDocument();
});
it.each([[1, 1], [2, 2], [3, 3], [6, 6], [8, 8], [10, 10], [12, 10]])('uses a stable full-grid skeleton for %i expected saved products', (expected, count) => {
  expect(getWishlistSkeletonCount(expected)).toBe(count);
  const view = renderPage(wishlistFixture({ data: undefined, isLoading: true, expectedCount: expected }));
  expect(view.getAllByTestId('product-skeleton')).toHaveLength(count);
  expect(view.queryByTestId('product-card')).not.toBeInTheDocument();
  expect(view.queryByText('Your wishlist is empty')).not.toBeInTheDocument();
});
it('does not show Empty Wishlist while authenticated items are unresolved on refresh', () => {
  renderPage(wishlistFixture({ data: undefined, isLoading: true, expectedCount: 3, totalItems: 3 }));
  expect(screen.queryByText('Your wishlist is empty')).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Wishlist count loading' })).toBeInTheDocument();
  expect(screen.queryByText('3 items')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('product-skeleton')).toHaveLength(3);
});
it('uses one neutral skeleton without inventing a zero count when the count is unknown', () => {
  renderPage(wishlistFixture({ data: undefined, isLoading: true, expectedCount: undefined, totalItems: 0 }));
  expect(screen.getByRole('status', { name: 'Wishlist count loading' })).toBeInTheDocument();
  expect(screen.queryByText('0 items')).not.toBeInTheDocument();
  expect(screen.queryByText('Your wishlist is empty')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('product-skeleton')).toHaveLength(1);
});
it('shows a definitive zero count only after an empty result resolves', () => {
  renderPage(wishlistFixture({ data: { items: [], totalItems: 0 }, expectedCount: 0, totalItems: 0 }));
  expect(screen.getByRole('status', { name: '0 items' })).toBeInTheDocument();
  expect(screen.getByText('Your wishlist is empty')).toBeInTheDocument();
});
it('shows one loading skeleton for a last-confirmed empty Wishlist until the server resolves', () => {
  renderPage(wishlistFixture({ data: undefined, isLoading: true, expectedCount: 0, totalItems: 0 }));
  expect(screen.getAllByTestId('product-skeleton')).toHaveLength(1);
  expect(screen.getByRole('status', { name: 'Wishlist count loading' })).toBeInTheDocument();
  expect(screen.queryByText('0 items')).not.toBeInTheDocument();
});
it('matches ProductCard skeleton parts in order and proportions', () => {
  const view = renderPage(wishlistFixture({ data: undefined, isLoading: true, expectedCount: 1 }));
  const parts = [...view.container.querySelectorAll('[data-skeleton-part]')].map(element => element.getAttribute('data-skeleton-part'));
  expect(parts).toEqual(['category', 'title', 'rating', 'description', 'price', 'action']);
  expect(view.getByTestId('product-skeleton-image')).toBeInTheDocument();
});
it('keeps usable cards visible without appending partial skeletons during refresh', () => {
  renderPage(wishlistFixture({ expectedCount: 3, pending: ['pending-product'] }));
  expect(screen.getByTestId('product-card')).toBeInTheDocument();
  expect(screen.queryByTestId('product-skeleton')).not.toBeInTheDocument();
});
it('empty state has a usable explore destination', () => {
  renderPage(wishlistFixture({ data: { items: [], totalItems: 0 }, totalItems: 0 }));
  expect(screen.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
});
it('unavailable products remain removable and do not offer Cart', () => {
  const toggle = vi.fn(); renderPage(wishlistFixture({ toggle, data: { items: [{ productId: wishlistProduct.id, product: null, availability: 'UNAVAILABLE' }], totalItems: 1 } }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable product' })); expect(toggle).toHaveBeenCalledWith(wishlistProduct.id);
  expect(screen.queryByRole('button', { name: /to cart/ })).not.toBeInTheDocument();
});
it('saved heart has pressed semantics and does not navigate', () => {
  const toggle = vi.fn(); renderPage(wishlistFixture({ toggle }));
  const heart = screen.getByRole('button', { name: /from wishlist/ });
  expect(heart).toHaveAttribute('aria-pressed', 'true'); fireEvent.click(heart); expect(toggle).toHaveBeenCalledOnce();
});
it('logout never renders guest empty state', () => {
  renderPage(wishlistFixture({ isLoggingOut: true, totalItems: 0, data: { items: [], totalItems: 0 } }));
  expect(screen.queryByText('Your wishlist is empty')).not.toBeInTheDocument();
});
