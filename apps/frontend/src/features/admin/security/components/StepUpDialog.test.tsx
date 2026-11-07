import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepUpDialog } from './StepUpDialog';
import { adminSecurityApi } from '../api';

const { mockStartAuthentication } = vi.hoisted(() => ({ mockStartAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...actual, browserSupportsWebAuthn: () => false, startAuthentication: (...args: unknown[]) => mockStartAuthentication(...args) };
});

describe('StepUpDialog passkey support', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['totp', 'recovery'] as const)('submits the %s form once while pending and preserves server verification', async method => {
    let finish!: () => void;
    const request = vi.spyOn(adminSecurityApi, 'stepUp').mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const verified = vi.fn();
    render(<StepUpDialog open onOpenChange={vi.fn()} onVerified={verified} />);
    if (method === 'recovery') {
      screen.getByRole('tab', { name: 'Authenticator app' }).focus();
      await userEvent.keyboard('{ArrowRight}');
    }
    const input = screen.getByRole('textbox', { name: method === 'totp' ? '6-digit code' : 'Recovery code' });
    fireEvent.change(input, { target: { value: method === 'totp' ? '123456' : 'synthetic-recovery-code' } });
    const form = input.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: method === 'totp' ? 'TOTP' : 'RECOVERY_CODE', code: method === 'totp' ? '123456' : 'synthetic-recovery-code' });
    expect(verified).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
    request.mockRestore();
  });

  it('disables passkey verification and explains the browser limitation when WebAuthn is unavailable', async () => {
    render(<StepUpDialog open onOpenChange={vi.fn()} onVerified={vi.fn()} />);
    const authenticatorTab = screen.getByRole('tab', { name: 'Authenticator app' });
    expect(authenticatorTab).toHaveAttribute('aria-selected', 'true');
    authenticatorTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Recovery code' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(authenticatorTab).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Passkey' })).toHaveAttribute('aria-selected', 'true');
    const passkeyButton = screen.getByRole('button', { name: 'Use passkey' });
    expect(passkeyButton).toBeDisabled();
    expect(passkeyButton.closest('[role="tabpanel"]')).toHaveTextContent(/Passkeys are not available in this browser/);
    fireEvent.click(passkeyButton);
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });
});
