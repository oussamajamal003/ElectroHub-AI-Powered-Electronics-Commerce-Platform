import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState } from './ErrorState';

describe('ErrorState Component', () => {
  it('renders title correctly and has alert role', () => {
    render(<ErrorState title="Unable to load products" />);
    expect(screen.getByText('Unable to load products')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders description if provided', () => {
    render(
      <ErrorState
        title="Error"
        description="Something went wrong while loading the products."
      />
    );
    expect(
      screen.getByText('Something went wrong while loading the products.')
    ).toBeInTheDocument();
  });

  it('renders action node if provided', () => {
    render(
      <ErrorState
        title="Error"
        action={<button>Try Again</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });
});
