import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('renders correctly', () => {
    render(<Textarea placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('handles value changes', async () => {
    const user = userEvent.setup();
    render(<Textarea placeholder="Message" />);
    
    const textarea = screen.getByPlaceholderText('Message');
    await user.type(textarea, 'Hello World');
    expect(textarea).toHaveValue('Hello World');
  });

  it('can be disabled', () => {
    render(<Textarea disabled placeholder="Disabled" />);
    expect(screen.getByPlaceholderText('Disabled')).toBeDisabled();
  });

  it('shows error state and message', () => {
    render(<Textarea error="Invalid input" placeholder="Error" />);
    expect(screen.getByText('Invalid input')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Error')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders label and helper text', () => {
    render(
      <Textarea 
        id="test-textarea" 
        label="Description" 
        helperText="Keep it short" 
      />
    );
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByText('Keep it short')).toBeInTheDocument();
  });
});
