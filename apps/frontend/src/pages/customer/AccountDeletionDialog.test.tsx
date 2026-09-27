import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionDialog } from './AccountDeletionDialog';
import { useAuth } from '@/features/auth/context/AuthContext';
import { authApi } from '@/features/auth/api/auth';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/auth/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/api/auth')>('@/features/auth/api/auth');
  return { ...actual, authApi: { ...actual.authApi, reauthenticateDeletionWithPassword: vi.fn(), prepareGoogleDeletionReauth: vi.fn(), deleteAccount: vi.fn() } };
});

describe('AccountDeletionDialog', () => {
  const clearSession = vi.fn();
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'customer-id', email: 'customer@example.invalid', firstName: 'Test', lastName: 'Customer', role: 'CUSTOMER', authMethods: { password: true, google: false } },
      isAuthenticated: true,
      isLoading: false,
      isInitializing: false,
      clearSession,
    } as never);
    vi.mocked(authApi.reauthenticateDeletionWithPassword).mockResolvedValue({ message: 'ok' });
    vi.mocked(authApi.deleteAccount).mockResolvedValue({ message: 'deleted' });
  });

  const renderDialog = () => render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountDeletionDialog open onOpenChange={onOpenChange} onDeleted={onDeleted} />
    </QueryClientProvider>
  );

  it('requires password re-authentication and the literal DELETE confirmation', async () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Delete your account?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Permanently Delete Account' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Current Password/), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with Password' }));
    await screen.findByLabelText(/Type DELETE to confirm/);
    expect(authApi.reauthenticateDeletionWithPassword).toHaveBeenCalledWith('correct-password');
    expect(authApi.deleteAccount).not.toHaveBeenCalled();

    const deleteButton = screen.getByRole('button', { name: 'Permanently Delete Account' });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    await waitFor(() => expect(authApi.deleteAccount).toHaveBeenCalledOnce());
    expect(clearSession).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('shows only Google re-authentication for a Google-only customer', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'customer-id', email: 'customer@example.invalid', firstName: 'Test', lastName: 'Customer', role: 'CUSTOMER', authMethods: { password: false, google: true } },
      isAuthenticated: true,
      isLoading: false,
      isInitializing: false,
      clearSession,
    } as never);
    renderDialog();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Current Password/)).not.toBeInTheDocument();
  });
});
