import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Spinner } from './Spinner';
import React from 'react';

describe('Spinner Component', () => {
  it('renders correctly', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('svg');
    expect(spinner).toBeInTheDocument();
    expect(spinner?.className.baseVal).toMatch(/spinner/);
  });
});
