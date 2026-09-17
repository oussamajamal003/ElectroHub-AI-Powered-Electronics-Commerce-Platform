import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Tooltip } from './Tooltip';



describe('Tooltip', () => {
  it('renders children and shows content on hover', async () => {
    render(
      <Tooltip content="Tooltip info" delayDuration={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: /hover me/i });
    expect(trigger).toBeInTheDocument();

    fireEvent.mouseOver(trigger);
    fireEvent.focus(trigger);

    await waitFor(() => {
      const tooltipContent = screen.getByText(/tooltip info/i);
      expect(tooltipContent).toBeInTheDocument();
    });
  });
});
