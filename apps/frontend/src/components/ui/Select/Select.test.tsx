import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Select } from './Select';

// Required for Radix UI portal to work in jsdom
window.HTMLElement.prototype.scrollIntoView = function() {};
window.HTMLElement.prototype.hasPointerCapture = function() { return false; };
window.HTMLElement.prototype.releasePointerCapture = function() {};

describe('Select', () => {
  const options = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'blueberry', label: 'Blueberry', disabled: true },
  ];

  it('renders correctly with placeholder', () => {
    render(<Select options={options} placeholder="Choose a fruit" />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(/choose a fruit/i);
  });

  it('renders with label', () => {
    render(<Select options={options} label="Fruits" />);
    // The label is associated with the trigger button
    const trigger = screen.getByRole('combobox', { name: /fruits/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens options list on click', async () => {
    const user = userEvent.setup();
    render(<Select options={options} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });
  });

  it('shows error message', () => {
    render(<Select options={options} error="Please select a fruit" />);
    const errorMessage = screen.getByText(/please select a fruit/i);
    expect(errorMessage).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Select options={options} disabled />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
  });
});
