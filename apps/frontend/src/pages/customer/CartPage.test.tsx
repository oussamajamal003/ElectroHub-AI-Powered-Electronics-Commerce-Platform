import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CartPageContent } from './CartPage';
import type { CartContextValue } from '@/features/cart/context';
import { ApiError } from '@/lib/api';

const base: CartContextValue = { data: undefined, totalQuantity: 0, isGuest: true, isLoggingOut: false, isLoading: false, isError: false,
  isMutating: false, pendingProductIds: [], pendingRemoveProductIds: [], mergeError: null, pendingGuestItems: [], addItem: vi.fn(), setQuantity: vi.fn(), removeItem: vi.fn(),
  retry: vi.fn(), retryMerge: vi.fn(), removePendingGuestItem: vi.fn() };
const show = (cart: CartContextValue) => render(<MemoryRouter><CartPageContent cart={cart} /></MemoryRouter>);

describe('cart page states', () => {
  it('shows an actionable guest empty state', () => {
    show({ ...base, data: { items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false } });
    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
  });
  it('keeps authenticated Cart content instead of showing guest empty state during logout', () => {
    const data = { items: [{ id: 'line-1', productId: '8f2813b4-a388-44d3-b51e-5d4c40386677', quantity: 1,
      product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '20.00', image: null },
      availableQuantity: 2, availability: 'AVAILABLE' as const, lineTotal: '20.00' }], totalQuantity: 1, subtotal: '20.00',
      shipping: '0.00', total: '20.00', currency: 'USD' as const, canCheckout: true };
    show({ ...base, isGuest: false, isLoggingOut: true, isLoading: true, totalQuantity: 1, data });
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  });
  it('reserves layout during loading and offers retry on error', () => {
    const view = show({ ...base, isLoading: true });
    expect(screen.getByRole('status', { name: 'Loading cart' })).toBeInTheDocument();
    expect(screen.getAllByTestId('cart-skeleton-row')).toHaveLength(2);
    expect(screen.getByTestId('cart-skeleton-summary').querySelectorAll('[aria-hidden="true"]')).toHaveLength(9);
    view.rerender(<MemoryRouter><CartPageContent cart={{ ...base, isError: true }} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
  it('does not artificially disable quantity controls while pending so rapid clicks accumulate', () => {
    const firstId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
    const secondId = '41f516ae-8385-4dcb-9a85-90b5dc9fe363';
    const createLine = (productId: string, name: string) => ({ id: productId, productId, quantity: 2,
      product: { slug: name.toLowerCase(), name, category: 'Phones', price: '10.00', image: null },
      availableQuantity: 5, availability: 'AVAILABLE' as const, lineTotal: '20.00' });
    show({ ...base, pendingProductIds: [firstId], data: { items: [createLine(firstId, 'Phone'), createLine(secondId, 'Tablet')],
      totalQuantity: 4, subtotal: '40.00', shipping: '0.00', total: '40.00', currency: 'USD', canCheckout: true } });
    expect(screen.getByRole('button', { name: 'Increase quantity for Phone' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Increase quantity for Tablet' })).toBeEnabled();
  });
  it('preserves cached rows but blocks checkout intent after revalidation fails', () => {
    show({ ...base, isError: true, data: { items: [{ id: null, productId: '8f2813b4-a388-44d3-b51e-5d4c40386677', quantity: 1,
      product: { slug: 'apple-iphone-15-pro', name: 'Apple iPhone 15 Pro', category: 'Phones', price: '1099.99', image: null },
      availableQuantity: 2, availability: 'AVAILABLE', lineTotal: '1099.99' }], totalQuantity: 1, subtotal: '1099.99',
      shipping: '0.00', total: '1099.99', currency: 'USD', canCheckout: true } });
    expect(screen.getByText('Apple iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry availability' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  });
  it('keeps unavailable lines visible, blocks checkout, and allows removal', async () => {
    const removeItem = vi.fn().mockResolvedValue(undefined);
    show({ ...base, removeItem, data: { items: [{ id: 'line-1', productId: '8f2813b4-a388-44d3-b51e-5d4c40386677', quantity: 2,
      product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null },
      availableQuantity: 0, availability: 'UNAVAILABLE', lineTotal: '39.98' }], totalQuantity: 2, subtotal: '39.98',
      shipping: '0.00', total: '39.98', currency: 'USD', canCheckout: false } });
    expect(screen.getByText('This product is unavailable. Remove it to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Phone from cart' }));
    await waitFor(() => expect(removeItem).toHaveBeenCalledWith('8f2813b4-a388-44d3-b51e-5d4c40386677'));
  });
  it('shows the sanitized stock conflict when inventory falls before an update', async () => {
    const setQuantity = vi.fn().mockRejectedValue(new ApiError(409, 'Only 2 items are currently available.', undefined, 'CART_STOCK_CONFLICT'));
    show({ ...base, setQuantity, data: { items: [{ id: 'line-1', productId: '8f2813b4-a388-44d3-b51e-5d4c40386677', quantity: 2,
      product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null },
      availableQuantity: 5, availability: 'AVAILABLE', lineTotal: '39.98' }], totalQuantity: 2, subtotal: '39.98',
      shipping: '0.00', total: '39.98', currency: 'USD', canCheckout: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity for Phone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 2 items are currently available.');
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });
});
