import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyState } from './EmptyState';
import React from 'react';
import { Box } from 'lucide-react';

describe('EmptyState Component', () => {
  it('renders correctly with title and description', () => {
    render(
      <EmptyState
        title="No items found"
        description="Try adjusting your filters"
        icon={<Box data-testid="icon" />}
        action={<button>Clear Filters</button>}
      />
    );

    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument();
  });
});
