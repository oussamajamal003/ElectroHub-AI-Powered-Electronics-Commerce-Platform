import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from './Badge';

describe('Badge Component', () => {
  it('renders correctly with neutral variant', () => {
    render(<Badge>Neutral Badge</Badge>);
    const badge = screen.getByText('Neutral Badge');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/variant-neutral/);
  });

  it('renders different variants', () => {
    render(<Badge variant="error">Error Badge</Badge>);
    const badge = screen.getByText('Error Badge');
    expect(badge.className).toMatch(/variant-error/);
  });
});
