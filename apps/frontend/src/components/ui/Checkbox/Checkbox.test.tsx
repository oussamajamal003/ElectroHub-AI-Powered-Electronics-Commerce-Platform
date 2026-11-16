import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox Component', () => {
  it('renders correctly', () => {
    render(<Checkbox aria-label="Test Checkbox" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Test Checkbox' });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('renders disabled state correctly', () => {
    render(<Checkbox aria-label="Disabled Checkbox" disabled />);
    const checkbox = screen.getByRole('checkbox', { name: 'Disabled Checkbox' });
    expect(checkbox).toBeDisabled();
  });
});
