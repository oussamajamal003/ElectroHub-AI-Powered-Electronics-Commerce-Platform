import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Switch } from './Switch';

describe('Switch Component', () => {
  it('renders correctly', () => {
    render(<Switch aria-label="Test Switch" />);
    const switchElement = screen.getByRole('switch', { name: 'Test Switch' });
    expect(switchElement).toBeInTheDocument();
    expect(switchElement).not.toBeChecked();
  });

  it('renders disabled state correctly', () => {
    render(<Switch aria-label="Disabled Switch" disabled />);
    const switchElement = screen.getByRole('switch', { name: 'Disabled Switch' });
    expect(switchElement).toBeDisabled();
  });
});
