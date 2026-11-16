import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerOverlay, DrawerPortal } from './Drawer';

describe('Drawer Component', () => {
  it('restores focus after keyboard dismissal of a controlled drawer without a Trigger', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open navigation</button><Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent><DrawerTitle>Navigation</DrawerTitle><DrawerDescription>Admin pages</DrawerDescription>
          <button>Dashboard</button></DrawerContent></Drawer></>;
    }
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus());
  });

  it('renders drawer content when open', () => {
    render(
      <Drawer open={true}>
        <DrawerPortal>
          <DrawerOverlay />
          <DrawerContent>
            <DrawerTitle>Drawer Title</DrawerTitle>
            <DrawerDescription>Drawer Description</DrawerDescription>
          </DrawerContent>
        </DrawerPortal>
      </Drawer>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Drawer Title')).toBeInTheDocument();
    expect(screen.getByText('Drawer Description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close drawer/i })).toBeInTheDocument();
  });
});
