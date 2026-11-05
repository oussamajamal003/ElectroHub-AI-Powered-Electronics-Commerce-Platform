import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminInvitePage, MIN_ADMIN_PASSWORD_LENGTH, passwordHint, readInvitationToken } from './AdminInvitePage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { adminAuthApi } from '@/features/admin/security/api';
import { ApiError } from '@/lib/api';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/admin/security/api', () => ({
  adminAuthApi: { previewInvitation: vi.fn(), acceptInvitation: vi.fn() },
}));

describe('readInvitationToken', () => {
  it('reads a token from the URL fragment', () => {
    expect(readInvitationToken('#token=abcdefghijklmnop1234')).toBe('abcdefghijklmnop1234');
  });

  it('rejects missing or malformed tokens', () => {
    expect(readInvitationToken('')).toBeNull();
    expect(readInvitationToken('#token=short')).toBeNull();
    expect(readInvitationToken('#token=has spaces and symbols!!')).toBeNull();
    expect(readInvitationToken('?token=abcdefghijklmnop1234')).toBeNull();
  });
});

describe('passwordHint', () => {
  it('states the minimum length before any password is typed', () => {
    expect(passwordHint('')).toContain(`${MIN_ADMIN_PASSWORD_LENGTH} to 128 characters`);
  });

  it('counts down the remaining characters while the password is short', () => {
    expect(passwordHint('abc')).toBe(`${MIN_ADMIN_PASSWORD_LENGTH - 3} more characters needed.`);
  });

  it('calls a long, varied password strong', () => {
    expect(passwordHint('correct-Horse-battery-9')).toBe('Strong password.');
  });

  it('explains required character types even for a long passphrase', () => {
    expect(passwordHint('several lowercase unrelated words')).toBe('Add an uppercase letter and a number.');
  });
});

describe('AdminInvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ completeAdminSession: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    window.history.replaceState(null, '', '/admin/invite');
  });

  it('tells the visitor the link is invalid when no token is present', async () => {
    render(<MemoryRouter><AdminInvitePage /></MemoryRouter>);

    expect(await screen.findByText(/This invitation link is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Create a password/i)).not.toBeInTheDocument();
  });

  const fillForm = async (password: string) => {
    window.history.replaceState(null, '', '/admin/invite#token=abcdefghijklmnop1234');
    vi.mocked(adminAuthApi.previewInvitation).mockResolvedValue({ email: 'invitee@qa.invalid', expiresAt: '2026-11-06T00:00:00Z' });
    render(<MemoryRouter><AdminInvitePage /></MemoryRouter>);
    await screen.findByLabelText('Create a password');
    for (const [label, value] of [['First name', 'New'], ['Last name', 'Admin'], ['Create a password', password], ['Confirm password', password]] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
  };

  it('does not submit a passphrase missing required character types', async () => {
    await fillForm('several lowercase unrelated words');
    expect(adminAuthApi.acceptInvitation).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Create a password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a server password validation error next to its field', async () => {
    vi.mocked(adminAuthApi.acceptInvitation).mockRejectedValueOnce(new ApiError(400, 'Check the highlighted fields.', {
      error: { code: 'VALIDATION_FAILED', fields: [{ field: 'password', message: 'Choose a different password.' }] },
    }, 'VALIDATION_FAILED'));
    await fillForm('Correct-Horse-9-Battery');
    await waitFor(() => expect(screen.getByText('Choose a different password.')).toBeInTheDocument());
    expect(screen.getByLabelText('Create a password')).toHaveAttribute('aria-invalid', 'true');
  });
});
