import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  const MockIcon = () => <svg data-testid="mock-icon" />;

  it('renders correctly with required props', () => {
    render(<IconButton icon={<MockIcon />} aria-label="Test Icon Button" />);
    
    const button = screen.getByRole('button', { name: 'Test Icon Button' });
    expect(button).toBeInTheDocument();
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <IconButton 
        icon={<MockIcon />} 
        aria-label="Click Me" 
        onClick={handleClick} 
      />
    );
    
    await user.click(screen.getByRole('button', { name: 'Click Me' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(
      <IconButton 
        icon={<MockIcon />} 
        aria-label="Disabled Button" 
        disabled 
      />
    );
    
    const button = screen.getByRole('button', { name: 'Disabled Button' });
    expect(button).toBeDisabled();
  });
});
