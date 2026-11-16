import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RadioGroup, RadioGroupItem } from './Radio';

describe('Radio Component', () => {
  it('renders correctly', () => {
    render(
      <RadioGroup aria-label="Test Radio Group">
        <RadioGroupItem value="option-1" aria-label="Option 1" />
      </RadioGroup>
    );
    const radioGroup = screen.getByRole('radiogroup', { name: 'Test Radio Group' });
    const radio = screen.getByRole('radio', { name: 'Option 1' });
    
    expect(radioGroup).toBeInTheDocument();
    expect(radio).toBeInTheDocument();
    expect(radio).not.toBeChecked();
  });

  it('renders disabled state correctly', () => {
    render(
      <RadioGroup>
        <RadioGroupItem value="option-1" aria-label="Disabled Radio" disabled />
      </RadioGroup>
    );
    const radio = screen.getByRole('radio', { name: 'Disabled Radio' });
    expect(radio).toBeDisabled();
  });
});
