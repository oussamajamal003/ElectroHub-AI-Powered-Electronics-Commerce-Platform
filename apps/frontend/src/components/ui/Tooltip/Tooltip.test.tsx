import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Tooltip } from './Tooltip';



import userEvent from '@testing-library/user-event';

describe('Tooltip', () => {
  it('renders children and shows content on hover', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Tooltip info" delayDuration={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: /hover me/i });
    expect(trigger).toBeInTheDocument();

    await user.hover(trigger);

    await waitFor(() => {
      const tooltipContent = screen.getByText(/tooltip info/i);
      expect(tooltipContent).toBeInTheDocument();
    });
  });
});
