import { render, screen, fireEvent } from '@testing-library/react';
import { QuantitySelector } from './QuantitySelector';
import { vi, describe, it, expect } from 'vitest';

describe('QuantitySelector Component', () => {
  it('renders correctly with given quantity', () => {
    render(<QuantitySelector quantity={3} onIncrease={vi.fn()} onDecrease={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onDecrease when minus button is clicked', () => {
    const onDecrease = vi.fn();
    render(<QuantitySelector quantity={3} onIncrease={vi.fn()} onDecrease={onDecrease} />);
    
    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onDecrease).toHaveBeenCalledTimes(1);
  });

  it('calls onIncrease when plus button is clicked', () => {
    const onIncrease = vi.fn();
    render(<QuantitySelector quantity={3} onIncrease={onIncrease} onDecrease={vi.fn()} />);
    
    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(onIncrease).toHaveBeenCalledTimes(1);
  });

  it('disables minus button when quantity equals minQuantity', () => {
    render(<QuantitySelector quantity={1} minQuantity={1} onIncrease={vi.fn()} onDecrease={vi.fn()} />);
    
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled();
  });

  it('disables plus button when quantity equals maxQuantity', () => {
    render(<QuantitySelector quantity={5} maxQuantity={5} onIncrease={vi.fn()} onDecrease={vi.fn()} />);
    
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
  });
});
