import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './DropdownMenu';

// Required for Radix UI portal to work in jsdom
window.HTMLElement.prototype.scrollIntoView = function() {};
window.HTMLElement.prototype.hasPointerCapture = function() { return false; };
window.HTMLElement.prototype.releasePointerCapture = function() {};

describe('DropdownMenu', () => {
  it('renders and opens the dropdown', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuItem disabled>Billing</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: /open/i });
    expect(trigger).toBeInTheDocument();

    // Click the trigger using fireEvent to avoid userEvent flakiness in CI
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(/my account/i)).toBeInTheDocument();
      const profileItem = screen.getByRole('menuitem', { name: /profile/i });
      expect(profileItem).toBeInTheDocument();
      
      const billingItem = screen.getByRole('menuitem', { name: /billing/i });
      expect(billingItem).toBeInTheDocument();
      expect(billingItem).toHaveAttribute('data-disabled', '');
    });
  });
});
