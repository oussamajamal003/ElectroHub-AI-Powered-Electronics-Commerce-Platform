import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Tooltip } from './Tooltip';

// Required for Radix UI portal to work in jsdom
window.HTMLElement.prototype.scrollIntoView = function() {};
window.HTMLElement.prototype.hasPointerCapture = function() { return false; };
window.HTMLElement.prototype.releasePointerCapture = function() {};

describe('Tooltip', () => {
  it('renders children and shows content on hover', async () => {
    render(
      <Tooltip content="Tooltip info" delayDuration={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: /hover me/i });
    expect(trigger).toBeInTheDocument();

    const user = userEvent.setup();

    // Hover over the trigger
    await user.hover(trigger);

    await waitFor(() => {
      const tooltipContent = screen.getByText(/tooltip info/i);
      expect(tooltipContent).toBeInTheDocument();
    });
  });
});
