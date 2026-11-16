import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';
import { IconButton } from '../IconButton';

describe('Tooltip', () => {
  it('renders children and shows content on hover', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Tooltip info" delayDuration={0}>
        <button>Hover me</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button', { name: /hover me/i });
    await user.hover(trigger);
    await waitFor(() => expect(screen.getAllByText(/tooltip info/i).length).toBeGreaterThan(0));
  });

  it('opens on keyboard focus, describes the trigger, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TooltipProvider delayDuration={0}><Tooltip content="Add to wishlist"><button aria-label="Wishlist">♡</button></Tooltip></TooltipProvider>);
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Wishlist' });
    expect(trigger).toHaveFocus();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Add to wishlist');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('explains a disabled control through a focusable wrapper without enabling it', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<TooltipProvider delayDuration={0}><Tooltip content="Only empty categories can be deleted" focusableWrapper><button disabled onClick={onClick}>Delete</button></Tooltip></TooltipProvider>);
    await user.tab();
    expect(document.querySelector('[data-tooltip-disabled-wrapper]')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Only empty categories can be deleted');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton tooltips', () => {
  it('shows its accessible name as the hint by default', async () => {
    const user = userEvent.setup();
    render(<TooltipProvider delayDuration={0}><IconButton aria-label="Open menu" icon={<span>≡</span>} /></TooltipProvider>);
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open menu');
  });

  it('supports a richer hint, opt-out, and a disabled reason', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TooltipProvider delayDuration={0}><IconButton aria-label="Delete" tooltip="Delete permanently" icon={<span>x</span>} /></TooltipProvider>);
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Delete permanently');
    await user.keyboard('{Escape}');
    rerender(<TooltipProvider delayDuration={0}><IconButton aria-label="Delete" tooltip={false} icon={<span>x</span>} /></TooltipProvider>);
    await user.tab(); await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    rerender(<TooltipProvider delayDuration={0}><IconButton aria-label="Delete" disabled disabledReason="You need the Owner role" icon={<span>x</span>} /></TooltipProvider>);
    document.querySelector<HTMLElement>('[data-tooltip-disabled-wrapper]')?.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('You need the Owner role');
  });
});
