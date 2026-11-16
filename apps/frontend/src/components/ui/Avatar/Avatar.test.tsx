import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar Component', () => {
  it('renders correctly with initials fallback', () => {
    render(<Avatar initials="OJ" aria-label="User Avatar" />);
    const initials = screen.getByText('OJ');
    expect(initials).toBeInTheDocument();
  });
});
