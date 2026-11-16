import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Footer } from './Footer';

describe('Footer Component', () => {
  it('renders children correctly', () => {
    render(
      <Footer>
        <p>Copyright © 2026 ElectroHub</p>
      </Footer>
    );

    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
    expect(screen.getByText(/copyright © 2026 electrohub/i)).toBeInTheDocument();
  });
});
