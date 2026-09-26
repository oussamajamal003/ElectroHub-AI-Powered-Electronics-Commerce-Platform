import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('toggles visibility without changing the value or submitting its form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput label="Password" defaultValue="stored-value" />
        <button type="submit">Submit</button>
      </form>
    );

    const input = screen.getByLabelText('Password');
    const showButton = screen.getByRole('button', { name: 'Show password' });
    expect(input).toHaveAttribute('type', 'password');

    await user.click(showButton);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('stored-value');
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('stored-value');
  });

  it('keeps visibility control keyboard accessible', async () => {
    const user = userEvent.setup();
    render(<PasswordInput label="New Password" value="secret" onChange={() => undefined} />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'text');
  });
});
