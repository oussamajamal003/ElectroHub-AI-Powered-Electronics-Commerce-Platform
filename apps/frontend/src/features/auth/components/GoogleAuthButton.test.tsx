import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuthButton } from './GoogleAuthButton';
import { authApi } from '../api/auth';

vi.mock('../api/auth', () => ({ authApi: { linkGoogle: vi.fn() } }));

describe('Google sign-in and secure linking UI', () => {
  const popup = { closed: false, close: vi.fn() };
  const success = vi.fn().mockResolvedValue(undefined);
  const busy = vi.fn();
  const respond = (status: string, origin = window.location.origin) => {
    const event = new Event('message');
    Object.assign(event, { origin, source: popup, data: { type: 'electrohub-google', status } });
    fireEvent(window, event);
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    vi.mocked(authApi.linkGoogle).mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());
  const open = async () => {
    render(<GoogleAuthButton onBusyChange={busy} onSuccess={success} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  };
  it('disables duplicate sign-in and updates auth only for trusted success', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Connecting to Google...' })).toBeDisabled();
    respond('success', 'https://attacker.invalid');
    expect(success).not.toHaveBeenCalled();
    respond('success');
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
  });
  it('shows a safe retryable provider error', async () => {
    await open(); respond('failure');
    expect(screen.getByText('Google sign-in could not be completed. Please try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });
  it('accepts the explicit local backend callback origin', async () => {
    await open();
    respond('success', 'http://localhost:5000');
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
  });
  it('ignores unknown structured message statuses', async () => {
    await open();
    respond('unknown');
    expect(success).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
  });
  it('handles an isolated popup through its transaction-specific same-origin channel', async () => {
    const channel = { close: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
    const createChannel = vi.fn(function () { return channel; });
    vi.stubGlobal('BroadcastChannel', createChannel);
    await open();
    expect(createChannel).toHaveBeenCalledWith(expect.stringMatching(/^electrohub-google-[0-9a-f-]+$/));
    channel.onmessage?.(new MessageEvent('message', { origin: 'https://attacker.invalid', data: { type: 'electrohub-google', status: 'success' } }));
    expect(success).not.toHaveBeenCalled();
    channel.onmessage?.(new MessageEvent('message', { origin: window.location.origin, data: { type: 'electrohub-google', status: 'success' } }));
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(channel.close).toHaveBeenCalled();
  });
  it('cancellation restores idle without an error', async () => {
    await open(); respond('cancelled');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });
  it('requires existing password ownership proof before linking', async () => {
    await open(); respond('linking_required');
    expect(screen.getByText(/An existing ElectroHub account/)).toBeVisible();
    await userEvent.type(screen.getByLabelText('ElectroHub account password'), 'password-proof');
    fireEvent.submit(screen.getByLabelText('ElectroHub account password').closest('form')!);
    await waitFor(() => expect(authApi.linkGoogle).toHaveBeenCalledWith('password-proof'));
    expect(success).toHaveBeenCalledOnce();
  });
  it('never exposes backend/provider details on linking failure', async () => {
    vi.mocked(authApi.linkGoogle).mockRejectedValue(new Error('secret-provider-error'));
    await open(); respond('linking_required');
    await userEvent.type(screen.getByLabelText('ElectroHub account password'), 'wrong-password');
    fireEvent.submit(screen.getByLabelText('ElectroHub account password').closest('form')!);
    await screen.findByText(/Unable to connect Google/);
    expect(screen.queryByText('secret-provider-error')).not.toBeInTheDocument();
  });
  it('explains a blocked popup without submitting another form', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await open();
    expect(screen.getByText('Allow popups to continue with Google.')).toBeVisible();
  });
});
