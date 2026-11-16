import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ElectroHubLoader } from './ElectroHubLoader';

describe('ElectroHubLoader', () => {
  it('announces page loading without exposing decorative icon', () => {
    render(<ElectroHubLoader page />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading page…');
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
