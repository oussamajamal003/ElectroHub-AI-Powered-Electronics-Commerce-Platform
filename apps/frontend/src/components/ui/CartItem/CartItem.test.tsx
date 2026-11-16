import { render, screen, fireEvent } from '@testing-library/react';
import { CartItem } from './CartItem';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

describe('CartItem Component', () => {
  const mockProps = {
    id: '123',
    title: 'Wireless Headphones',
    subtitle: 'Noise Cancelling',
    price: 299.99,
    imageUrl: 'https://via.placeholder.com/150',
    quantity: 2,
    onQuantityChange: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<CartItem {...mockProps} />);
    expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
    expect(screen.getByText('Noise Cancelling')).toBeInTheDocument();
    expect(screen.getByText('$299.99')).toBeInTheDocument();
  });

  it('renders discount price if provided', () => {
    render(<CartItem {...mockProps} price={299.99} discountPrice={199.99} />);
    expect(screen.getByText('$199.99')).toBeInTheDocument();
    expect(screen.getByText('$299.99')).toHaveClass(/originalPrice/);
  });

  it('calls onRemove when remove button is clicked', () => {
    render(<CartItem {...mockProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Wireless Headphones from cart' }));
    expect(mockProps.onRemove).toHaveBeenCalledWith('123');
  });

  it('calls onQuantityChange when quantity is modified', () => {
    render(<CartItem {...mockProps} />);
    
    // Increase
    fireEvent.click(screen.getByLabelText('Increase quantity for Wireless Headphones'));
    expect(mockProps.onQuantityChange).toHaveBeenCalledWith('123', 3);

    // Decrease
    fireEvent.click(screen.getByLabelText('Decrease quantity for Wireless Headphones'));
    expect(mockProps.onQuantityChange).toHaveBeenCalledWith('123', 1);
  });

  it('reduces stale quantity directly to current stock when stock fell', () => {
    render(<CartItem {...mockProps} quantity={4} maxQuantity={2} />);
    fireEvent.click(screen.getByLabelText('Decrease quantity for Wireless Headphones'));
    expect(mockProps.onQuantityChange).toHaveBeenCalledWith('123', 2);
    expect(screen.getByLabelText('Increase quantity for Wireless Headphones')).toBeDisabled();
  });

  it('lets an out-of-stock line decrease while blocking increase and keeping remove available', () => {
    render(<CartItem {...mockProps} quantity={3} maxQuantity={0} unavailable stockStatus="OUT_OF_STOCK" />);
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase quantity for Wireless Headphones')).toBeDisabled();
    expect(screen.getByLabelText('Decrease quantity for Wireless Headphones')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Decrease quantity for Wireless Headphones'));
    expect(mockProps.onQuantityChange).toHaveBeenCalledWith('123', 2);
    expect(screen.getByRole('button', { name: 'Remove Wireless Headphones from cart' })).toBeEnabled();
  });

  it('keeps remove available and disables decrement at one for an out-of-stock line', () => {
    render(<CartItem {...mockProps} quantity={1} maxQuantity={0} unavailable stockStatus="OUT_OF_STOCK" />);
    expect(screen.getByLabelText('Increase quantity for Wireless Headphones')).toBeDisabled();
    expect(screen.getByLabelText('Decrease quantity for Wireless Headphones')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Wireless Headphones from cart' })).toBeEnabled();
  });

  it('navigates from product content, but not quantity or remove controls', () => {
    render(<MemoryRouter initialEntries={['/cart']}><Routes>
      <Route path="/cart" element={<CartItem {...mockProps} productHref="/products/headphones" />} />
      <Route path="/products/:slug" element={<p>Product details route</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity for Wireless Headphones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Wireless Headphones from cart' }));
    expect(screen.queryByText('Product details route')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /Wireless Headphones/ }));
    expect(screen.getByText('Product details route')).toBeInTheDocument();
  });
});
