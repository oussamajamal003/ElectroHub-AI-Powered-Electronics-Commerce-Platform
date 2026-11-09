import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './Dialog';

function ControlledDialog() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open verification</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogTitle>Verification</DialogTitle><DialogDescription>Confirm your identity.</DialogDescription>
      <input aria-label="Verification code" autoFocus />
    </DialogContent></Dialog></>;
}

describe('controlled dialog keyboard focus', () => {
  it('returns focus to its opener after Escape without requiring a Radix Trigger', async () => {
    render(<ControlledDialog />);
    const opener = screen.getByRole('button', { name: 'Open verification' });
    opener.focus(); fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
