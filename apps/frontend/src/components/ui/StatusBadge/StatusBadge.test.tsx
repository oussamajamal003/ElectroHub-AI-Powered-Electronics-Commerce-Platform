import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders correctly with default props', () => {
    const { container } = render(<StatusBadge>Pending</StatusBadge>);
    
    expect(screen.getByText('Pending')).toBeInTheDocument();
    
    // Check if the neutral variant is applied to the dot by default
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).toHaveClass(/variant-neutral/);
    
    // Check if medium size is applied by default
    expect(container.firstChild).toHaveClass(/size-md/);
  });

  it('applies the correct variant class', () => {
    const { container } = render(<StatusBadge variant="success">Active</StatusBadge>);
    
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).toHaveClass(/variant-success/);
  });

  it('applies the correct size class', () => {
    const { container } = render(<StatusBadge size="sm">Suspended</StatusBadge>);
    
    expect(container.firstChild).toHaveClass(/size-sm/);
  });
});
