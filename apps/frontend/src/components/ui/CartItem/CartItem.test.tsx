import { render, screen, fireEvent } from '@testing-library/react';
import { CartItem } from './CartItem';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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
    // There are 2 remove buttons (desktop and mobile), so we can get all by label
    const removeButtons = screen.getAllByLabelText(/Remove Wireless Headphones from cart/);
    fireEvent.click(removeButtons[0]!);
    expect(mockProps.onRemove).toHaveBeenCalledWith('123');
  });

  it('calls onQuantityChange when quantity is modified', () => {
    render(<CartItem {...mockProps} />);
    
    // Increase
    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(mockProps.onQuantityChange).toHaveBeenCalledWith('123', 3);

    // Decrease
    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(mockProps.onQuantityChange).toHaveBeenCalledWith('123', 1);
  });
});
