import { describe, expect, it } from 'vitest';
import type { AdministratorSummary } from './api';
import { twoStepStatus } from './twoStepStatus';

const now = new Date('2026-11-06T12:00:00.000Z');
const row = (overrides: Partial<AdministratorSummary> = {}): AdministratorSummary => ({
  id: 'u1', email: 'a@example.invalid', firstName: 'A', lastName: 'B', isActive: true, isOwner: false, canManageAdmins: false,
  mfaEnrolled: false, mfaActivation: null, enrollmentAuthorizedUntil: null, isSelf: false, lastLoginAt: null, ...overrides,
});
const activation = (overrides = {}) => ({ id: 'a1', status: 'PENDING' as const, deliveryStatus: 'SENT' as const, expiresAt: '2026-11-06T12:20:00.000Z', lastSentAt: null, sendCount: 1, ...overrides });

describe('twoStepStatus', () => {
  it('offers activation only to an active, factor-less administrator with nothing pending', () => {
    expect(twoStepStatus(row(), now)).toMatchObject({ label: 'Not set up', action: 'activate', canRevoke: false });
  });

  it('never offers an emailed activation for a seed mailbox; points to operator setup instead', () => {
    expect(twoStepStatus(row({ seedAccount: { recorded: true } }), now)).toMatchObject({ label: 'Operator setup required', action: 'none', canRevoke: false,
      detail: 'Ask an operator for a one-time setup link.' });
    expect(twoStepStatus(row({ seedAccount: { recorded: false } }), now).detail).toMatch(/must record this seed account/);
  });

  it('keeps only Revoke for an emailed link already sent to a seed mailbox', () => {
    expect(twoStepStatus(row({ seedAccount: { recorded: false }, mfaActivation: activation() }), now)).toMatchObject({ label: 'Operator setup required', action: 'none', canRevoke: true });
  });

  it('shows an operator-issued setup link as pending with no console action; an expired one asks for a new link', () => {
    const issued = activation({ purpose: 'SEED_PROVISIONING' as const });
    expect(twoStepStatus(row({ seedAccount: { recorded: true }, mfaActivation: issued }), now)).toMatchObject({ label: 'Operator setup pending', detail: 'Setup link expires in 20 min', action: 'none', canRevoke: false });
    expect(twoStepStatus(row({ seedAccount: { recorded: true }, mfaActivation: { ...issued, status: 'EXPIRED' as const } }), now)).toMatchObject({ label: 'Operator setup required', canRevoke: false });
  });

  it('a seed account that is enrolled, inactive or inside its setup window keeps the normal states', () => {
    expect(twoStepStatus(row({ seedAccount: { recorded: true }, mfaEnrolled: true }), now).label).toBe('Enabled');
    expect(twoStepStatus(row({ seedAccount: { recorded: true }, isActive: false }), now).label).toBe('Inactive');
    expect(twoStepStatus(row({ seedAccount: { recorded: true }, enrollmentAuthorizedUntil: '2026-11-06T12:10:00.000Z' }), now).label).toBe('Setup pending');
  });

  it('shows an enrolled administrator as enabled with no activation action', () => {
    expect(twoStepStatus(row({ mfaEnrolled: true, mfaActivation: activation() }), now)).toMatchObject({ tone: 'success', label: 'Enabled', action: 'none', canRevoke: false });
  });

  it('never offers activation for an inactive account', () => {
    expect(twoStepStatus(row({ isActive: false }), now)).toMatchObject({ label: 'Inactive', action: 'none' });
  });

  it('shows a pending activation with its remaining time and resend/revoke only', () => {
    expect(twoStepStatus(row({ mfaActivation: activation() }), now)).toMatchObject({ label: 'Activation pending', detail: 'Link expires in 20 min', action: 'resend', canRevoke: true });
  });

  it('reports a failed delivery so the Owner can retry', () => {
    expect(twoStepStatus(row({ mfaActivation: activation({ deliveryStatus: 'FAILED' }) }), now)).toMatchObject({ tone: 'error', label: 'Email delivery failed', action: 'resend' });
  });

  it('treats a lapsed link as expired and allows an authorized resend', () => {
    expect(twoStepStatus(row({ mfaActivation: activation({ status: 'EXPIRED' }) }), now)).toMatchObject({ label: 'Link expired', action: 'resend' });
    expect(twoStepStatus(row({ mfaActivation: activation({ expiresAt: '2026-11-06T11:59:00.000Z' }) }), now)).toMatchObject({ label: 'Link expired' });
  });

  it('shows the short setup window after redemption without any action', () => {
    expect(twoStepStatus(row({ enrollmentAuthorizedUntil: '2026-11-06T12:12:00.000Z' }), now)).toMatchObject({ label: 'Setup pending', detail: '12 min left', action: 'none' });
    expect(twoStepStatus(row({ enrollmentAuthorizedUntil: '2026-11-06T11:00:00.000Z' }), now)).toMatchObject({ label: 'Not set up', action: 'activate' });
  });
});
