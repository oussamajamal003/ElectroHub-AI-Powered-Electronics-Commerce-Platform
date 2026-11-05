import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepUpDialog } from './StepUpDialog';

const { mockStartAuthentication } = vi.hoisted(() => ({ mockStartAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...actual, browserSupportsWebAuthn: () => false, startAuthentication: (...args: unknown[]) => mockStartAuthentication(...args) };
});

describe('StepUpDialog passkey support', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables passkey verification and explains the browser limitation when WebAuthn is unavailable', async () => {
    render(<StepUpDialog open onOpenChange={vi.fn()} onVerified={vi.fn()} />);
    const authenticatorTab = screen.getByRole('tab', { name: 'Authenticator app' });
    expect(authenticatorTab).toHaveAttribute('aria-selected', 'true');
    authenticatorTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Recovery code' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Passkey' })).toHaveAttribute('aria-selected', 'true');
    const passkeyButton = screen.getByRole('button', { name: 'Use passkey' });
    expect(passkeyButton).toBeDisabled();
    expect(passkeyButton.closest('[role="tabpanel"]')).toHaveTextContent(/Passkeys are not available in this browser/);
    fireEvent.click(passkeyButton);
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });
});
