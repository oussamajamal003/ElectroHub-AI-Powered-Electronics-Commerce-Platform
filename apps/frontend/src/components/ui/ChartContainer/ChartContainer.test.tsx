import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChartContainer } from './ChartContainer';

describe('ChartContainer', () => {
  it('renders title and description', () => {
    render(
      <ChartContainer title="Sales" description="Monthly overview">
        <div data-testid="chart-content">Chart Content</div>
      </ChartContainer>
    );

    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Monthly overview')).toBeInTheDocument();
    expect(screen.getByTestId('chart-content')).toBeInTheDocument();
  });

  it('renders empty state when empty prop is true', () => {
    render(
      <ChartContainer title="Sales" empty>
        <div data-testid="chart-content">Chart Content</div>
      </ChartContainer>
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-content')).not.toBeInTheDocument();
  });

  it('renders custom empty message', () => {
    render(
      <ChartContainer title="Sales" empty emptyMessage="Custom empty">
        <div data-testid="chart-content">Chart Content</div>
      </ChartContainer>
    );

    expect(screen.getByText('Custom empty')).toBeInTheDocument();
  });

  it('renders loading state when loading prop is true', () => {
    const { container } = render(
      <ChartContainer title="Sales" loading>
        <div data-testid="chart-content">Chart Content</div>
      </ChartContainer>
    );

    // Skeleton blocks should be present, but title and content shouldn't be
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-content')).not.toBeInTheDocument();
    
    // We expect 5 skeleton blocks based on our implementation
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBe(5);
  });
});
