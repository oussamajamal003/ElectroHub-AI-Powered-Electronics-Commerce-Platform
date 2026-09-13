import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './Input';
import React from 'react';

describe('Input', () => {
  it('renders correctly with basic props', () => {
    render(<Input placeholder="Enter text" />);
    const input = screen.getByPlaceholderText(/enter text/i);
    expect(input).toBeInTheDocument();
  });

  it('renders with a label and generates associated IDs', () => {
    render(<Input label="Email Address" />);
    const input = screen.getByLabelText(/email address/i);
    expect(input).toBeInTheDocument();
  });

  it('displays helper text and associates it with the input via aria-describedby', () => {
    render(<Input helperText="We will not share your email." />);
    const input = screen.getByRole('textbox');
    const helperText = screen.getByText(/we will not share your email/i);
    expect(helperText).toBeInTheDocument();
    
    const ariaDescribedBy = input.getAttribute('aria-describedby');
    expect(ariaDescribedBy).toBe(helperText.id);
  });

  it('displays error text and sets aria-invalid', () => {
    render(<Input error="Invalid email address" />);
    const input = screen.getByRole('textbox');
    const errorText = screen.getByText(/invalid email address/i);
    
    expect(errorText).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    
    const ariaDescribedBy = input.getAttribute('aria-describedby');
    expect(ariaDescribedBy).toBe(errorText.id);
  });

  it('renders required indicator when required prop is true and label is present', () => {
    render(<Input label="Email" required />);
    const requiredIndicator = screen.getByText('*');
    expect(requiredIndicator).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input label="Email" disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});
