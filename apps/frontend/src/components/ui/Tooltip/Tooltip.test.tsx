import { render, screen, fireEvent } from '@testing-library/react';
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

    // Trigger hover/focus to open tooltip
    fireEvent.mouseOver(trigger);
    fireEvent.focus(trigger);

    await waitFor(() => {
      const tooltipContent = screen.getByText(/tooltip info/i);
      expect(tooltipContent).toBeInTheDocument();
    });
  });
});
