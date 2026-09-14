import { render, screen } from '@testing-library/react';
import { Rating } from './Rating';
import { describe, it, expect } from 'vitest';

describe('Rating Component', () => {
  it('renders a valid rating with accessible label', () => {
    render(<Rating value={4.8} reviewCount={124} />);
    
    const container = screen.getByRole('img', { name: 'Rated 4.8 out of 5 based on 124 reviews.' });
    expect(container).toBeInTheDocument();
  });

  it('renders no rating state', () => {
    render(<Rating value={0} />);
    
    const container = screen.getByRole('img', { name: 'No rating' });
    expect(container).toBeInTheDocument();
  });

  it('safely handles values out of bounds', () => {
    render(<Rating value={6} />);
    
    const container = screen.getByRole('img', { name: 'Rated 5.0 out of 5.' });
    expect(container).toBeInTheDocument();
  });
});
