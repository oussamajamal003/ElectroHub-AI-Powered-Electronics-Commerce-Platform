import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Header } from './Header';

describe('Header Component', () => {
  it('renders children correctly', () => {
    render(
      <Header>
        <div data-testid="logo">Logo</div>
        <nav>Navigation</nav>
      </Header>
    );

    const header = screen.getByRole('banner');
    expect(header).toBeInTheDocument();
    
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
  });
});
