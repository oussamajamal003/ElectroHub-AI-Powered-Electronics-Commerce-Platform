import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastCenter } from '../Toast';
import { ProductCard } from './ProductCard';

const renderCard = (onAddToCart: () => Promise<void>) => render(<>
  <ProductCard id="p1" title="Aurora Headphones" imageUrl="/a.jpg" price={99} onAddToCart={onAddToCart} />
  <ToastCenter />
</>);

describe('ProductCard add-to-cart feedback', () => {
  it('shows a visual-only confirmation after the add actually succeeded', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    renderCard(() => new Promise<void>(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Add Aurora Headphones to cart' }));
    // Pending: nothing claims success yet.
    expect(screen.queryByText('Added to cart')).not.toBeInTheDocument();
    finish();
    const toast = await screen.findByText('Added to cart');
    expect(toast.closest('[data-radix-toast-announce-exclude]')).not.toBeNull();
    // The existing inline status remains the single screen-reader announcement.
    expect(screen.getAllByRole('status').some(node => /Aurora Headphones added to cart\./.test(node.textContent ?? ''))).toBe(true);
  });

  it('reports a failed add with the same safe message as the inline alert and no success toast', async () => {
    const user = userEvent.setup();
    renderCard(() => Promise.reject(new Error('internal SQL detail')));
    await user.click(screen.getByRole('button', { name: 'Add Aurora Headphones to cart' }));
    expect(await screen.findByText("Couldn't add to cart")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Could not add item. Please try again.').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('Added to cart')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('internal SQL detail');
  });
});
