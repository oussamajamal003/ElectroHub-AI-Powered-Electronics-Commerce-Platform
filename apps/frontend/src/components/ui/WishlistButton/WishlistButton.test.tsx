import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WishlistButton } from './WishlistButton';

describe('WishlistButton', () => {
  it('toggles with a stateful accessible name', () => {
    const onToggle = vi.fn();
    render(<WishlistButton title="Test Tablet" saved={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Test Tablet to wishlist' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('cannot be clicked while disabled, so a toggle the wishlist would drop is never offered (Task 06.1 D-2)', () => {
    const onToggle = vi.fn();
    render(<WishlistButton title="Test Tablet" saved={false} pending disabled onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Add Test Tablet to wishlist' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
