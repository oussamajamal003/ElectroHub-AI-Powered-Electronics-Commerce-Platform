import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Activity } from 'lucide-react';
import { StatsCard } from './StatsCard';

describe('StatsCard', () => {
  it('renders title and value', () => {
    render(<StatsCard title="Total Revenue" value="$45,231.89" />);
    
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('$45,231.89')).toBeInTheDocument();
  });

  it('renders trend up correctly', () => {
    render(
      <StatsCard 
        title="Active Users" 
        value="+2350" 
        trend="up" 
        trendValue="+180.1%" 
      />
    );
    
    expect(screen.getByText('+180.1%')).toBeInTheDocument();
    // Container should have the trend-up class
    const trendValue = screen.getByText('+180.1%');
    expect(trendValue.parentElement?.className).toContain('trend-up');
  });

  it('renders trend down correctly', () => {
    render(
      <StatsCard 
        title="Bounce Rate" 
        value="42%" 
        trend="down" 
        trendValue="-4.5%" 
      />
    );
    
    expect(screen.getByText('-4.5%')).toBeInTheDocument();
    const trendValue = screen.getByText('-4.5%');
    expect(trendValue.parentElement?.className).toContain('trend-down');
  });

  it('renders icon when provided', () => {
    render(
      <StatsCard 
        title="Sales" 
        value="1,234" 
        icon={<Activity data-testid="activity-icon" />} 
      />
    );
    
    expect(screen.getByTestId('activity-icon')).toBeInTheDocument();
  });
});
