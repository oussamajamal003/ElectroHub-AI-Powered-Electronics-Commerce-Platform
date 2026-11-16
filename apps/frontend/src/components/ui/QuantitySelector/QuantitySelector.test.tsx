import { render, screen, fireEvent } from '@testing-library/react';
import { QuantitySelector } from './QuantitySelector';
import { vi, describe, it, expect, afterEach } from 'vitest';

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

  it('can disable only the increment control', () => {
    const onDecrease = vi.fn();
    render(<QuantitySelector quantity={3} maxQuantity={10} increaseDisabled onIncrease={vi.fn()} onDecrease={onDecrease} />);
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
    expect(screen.getByLabelText('Decrease quantity')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onDecrease).toHaveBeenCalledOnce();
  });
});

describe('QuantitySelector press and hold', () => {
  afterEach(() => { vi.useRealTimers(); });
  const press = (button: HTMLElement, ms: number) => {
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(ms);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
  };

  it('a quick tap steps exactly once', () => {
    vi.useFakeTimers();
    const onDecrease = vi.fn();
    render(<QuantitySelector quantity={3} onIncrease={vi.fn()} onDecrease={onDecrease} productName="Dock" />);
    press(screen.getByRole('button', { name: 'Decrease quantity for Dock' }), 50);
    expect(onDecrease).toHaveBeenCalledTimes(1);
  });

  it.each([350, 400, 449])('a slow tap released after %i ms still steps exactly once (it used to change nothing)', ms => {
    vi.useFakeTimers();
    const onDecrease = vi.fn();
    render(<QuantitySelector quantity={3} onIncrease={vi.fn()} onDecrease={onDecrease} productName="Dock" />);
    press(screen.getByRole('button', { name: 'Decrease quantity for Dock' }), ms);
    expect(onDecrease).toHaveBeenCalledTimes(1);
  });

  it('holding repeats every 100 ms after the first step and the closing click adds nothing', () => {
    vi.useFakeTimers();
    const onIncrease = vi.fn();
    render(<QuantitySelector quantity={3} onIncrease={onIncrease} onDecrease={vi.fn()} productName="Dock" />);
    press(screen.getByRole('button', { name: 'Increase quantity for Dock' }), 650);
    expect(onIncrease).toHaveBeenCalledTimes(4); // 350 ms (first step), then 450, 550 and 650 ms
  });

  it('the next tap after a hold steps again', () => {
    vi.useFakeTimers();
    const onIncrease = vi.fn();
    render(<QuantitySelector quantity={3} onIncrease={onIncrease} onDecrease={vi.fn()} productName="Dock" />);
    const button = screen.getByRole('button', { name: 'Increase quantity for Dock' });
    press(button, 400);
    press(button, 50);
    expect(onIncrease).toHaveBeenCalledTimes(2);
  });
});
